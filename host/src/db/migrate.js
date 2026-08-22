import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { createBackup } from '../task/backup.js';

// 宿主启动时按 PRAGMA user_version 顺序执行 db/migrations/NNNN_*.sql
// SQL 在 wasm 模块内的事务中执行（BEGIN/COMMIT + user_version 更新）
// 有待执行迁移且库非空（user_version > 0）时，先自动备份（disaster-recovery.md 2.1）
export async function runMigrations(runtime, { root, dbPath, wasmPath }) {
  const dir = path.join(root, 'db', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const wasmDbPath = runtime.relPath(dbPath);
  const init = await runtime.invoke({ op: 'db.init', args: { path: wasmDbPath } });
  if (init.code !== 0) throw new Error(`db.init failed: ${init.message}`);

  let current = init.data.user_version;
  const pending = files.filter((f) => Number(f.slice(0, 4)) > current);
  if (pending.length > 0 && current > 0) {
    const dest = await createBackup({ runtime, wasmPath, dbPath, verify: Boolean(wasmPath) });
    logger.info('pre-migration backup created', { file: dest });
  }
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const res = await runtime.invoke({ op: 'db.migrate', args: { sql, version } });
    if (res.code !== 0) throw new Error(`migration ${file} failed: ${res.message}`);
    current = res.data.user_version;
    logger.info('migration applied', { file, version });
  }
  return current;
}
