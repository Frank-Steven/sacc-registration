// 备份任务（disaster-recovery.md 二 / 2.1）：
// - checkpoint WAL → wasm op db.backup 在线复制主库 → 校验（临时 runtime integrity/user_version/表冒烟）
// - 保留策略：最近 7 份全保留 + 每日 1 份保留 30 天，超限删除
import fs from 'node:fs';
import path from 'node:path';
import { WasmRuntime } from '../wasm-runtime/runtime.js';
import { logger } from '../logger.js';

const BACKUP_RE = /^sacc-(\d{8})-(\d{6})(?:-(\d+))?\.db$/;

function backupStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

// 校验备份文件：加载到临时 runtime，执行 integrity_check + user_version + 表计数冒烟
async function verifyBackup({ wasmPath, backupFile, expectedVersion }) {
  const dir = path.dirname(backupFile);
  const verifier = await WasmRuntime.load(wasmPath, dir);
  const init = await verifier.invoke({ op: 'db.init', args: { path: verifier.relPath(backupFile) } });
  if (init.code !== 0) throw new Error(`backup verify: db.init failed: ${init.message}`);
  const integ = await verifier.invoke({ op: 'db.query', args: { sql: 'PRAGMA integrity_check;' } });
  const row = integ.data?.rows?.[0];
  if (integ.code !== 0 || !row || row.integrity_check !== 'ok') {
    throw new Error('backup verify: integrity_check failed');
  }
  if (expectedVersion !== undefined) {
    const uv = await verifier.invoke({ op: 'db.user_version' });
    if (uv.data?.user_version !== expectedVersion) {
      throw new Error(
        `backup verify: user_version mismatch ${uv.data?.user_version} != ${expectedVersion}`,
      );
    }
  }
  const tables = await verifier.invoke({
    op: 'db.query',
    args: { sql: "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table';" },
  });
  const count = tables.data?.rows?.[0]?.c;
  if (!count || count < 5) throw new Error('backup verify: table smoke failed');
}

// 保留策略：最近 keepRecent 份全保留；其余按天保留最新 1 份、超过 keepDays 天删除
export function runRetention(dir, { keepRecent = 7, keepDays = 30, now = new Date() } = {}) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
  } catch {
    return 0;
  }
  const cutoff = now.getTime() - keepDays * 86400000;
  const keep = new Set(files.slice(-keepRecent));
  const byDate = new Map(); // 每日保留最新（files 升序，后写覆盖）；日期为文件名第 5~13 位 YYYYMMDD
  for (const f of files.slice(0, -keepRecent)) byDate.set(f.slice(5, 13), f);
  for (const f of byDate.values()) keep.add(f);

  let pruned = 0;
  for (const f of files) {
    const abs = path.join(dir, f);
    const tooOld = fs.existsSync(abs) && fs.statSync(abs).mtimeMs < cutoff;
    if (!keep.has(f) || tooOld) {
      try {
        fs.unlinkSync(abs);
        pruned += 1;
        logger.info('backup pruned', { file: f });
      } catch {
        // 并发删除等场景忽略
      }
    }
  }
  return pruned;
}

// 执行一次备份：checkpoint → db.backup → 校验 → 保留清理
/**
 * @param {object} opts
 * @param {import('../wasm-runtime/runtime.js').WasmRuntime} opts.runtime
 * @param {string} [opts.wasmPath]
 * @param {string} opts.dbPath
 * @param {boolean} [opts.verify]
 * @param {number} [opts.expectedVersion]
 * @returns {Promise<string>}
 */
export async function createBackup({ runtime, wasmPath, dbPath, verify = true, expectedVersion }) {
  const dir = path.join(path.dirname(dbPath), 'backup');
  fs.mkdirSync(dir, { recursive: true });

  // 前置：收缩 WAL，保证备份文件自洽（WAL 模式下备份 API 不含未 checkpoint 帧）
  await runtime.invoke({ op: 'db.exec', args: { sql: 'PRAGMA wal_checkpoint(TRUNCATE);' } });

  if (expectedVersion === undefined) {
    const uv = await runtime.invoke({ op: 'db.user_version' });
    if (uv.code === 0) expectedVersion = uv.data.user_version;
  }

  // 同名冲突（同秒内多次备份）追加序号，保证不覆盖
  let fileName = `sacc-${backupStamp()}.db`;
  let seq = 0;
  while (fs.existsSync(path.join(dir, fileName))) {
    seq += 1;
    fileName = `sacc-${backupStamp()}-${seq}.db`;
  }
  const dest = path.join(dir, fileName);
  const res = await runtime.invoke({ op: 'db.backup', args: { path: runtime.relPath(dest) } });
  if (res.code !== 0) throw new Error(`db.backup failed: ${res.message}`);

  if (verify && wasmPath) {
    await verifyBackup({ wasmPath, backupFile: dest, expectedVersion });
  }
  runRetention(dir);
  return dest;
}

// 数据目录容量告警（disaster-recovery.md 四）
export function checkDiskSpace(dir, minFreeBytes = 100 * 1024 * 1024) {
  try {
    const st = fs.statfsSync(dir);
    const free = st.bavail * st.bsize;
    if (free < minFreeBytes) {
      logger.warn('data disk space low', { dir, freeBytes: free });
    }
    return free;
  } catch {
    return null;
  }
}

// 每日定时备份：启动即做一次，此后按 intervalMs 周期执行
export function scheduleDailyBackup({ runtime, wasmPath, dbPath, intervalMs = 24 * 3600 * 1000 }) {
  const run = async () => {
    try {
      checkDiskSpace(path.dirname(dbPath));
      const dest = await createBackup({ runtime, wasmPath, dbPath, expectedVersion: undefined });
      logger.info('daily backup done', { file: dest });
    } catch (err) {
      logger.error('daily backup failed', { err: err.message });
    }
  };
  run();
  return setInterval(run, intervalMs);
}
