import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { logger } from './logger.js';
import { WasmRuntime } from './wasm-runtime/runtime.js';
import { runMigrations } from './db/migrate.js';
import { scheduleDailyBackup } from './task/backup.js';
import { scheduleNotify } from './task/notify.js';
import { createMailer } from './mail/smtp.js';
import { createRoutes } from './http/routes.js';
import { createServer } from './http/server.js';

async function main() {
  // JWT_SECRET 未配置时生成临时随机密钥（重启后 token 失效，仅限开发）；生产必须显式配置
  if (!config.jwtSecret) {
    config.jwtSecret = crypto.randomBytes(32).toString('hex');
    logger.warn('JWT_SECRET 未配置，已生成临时密钥（重启后会话失效），生产环境请显式配置');
  }

  // WASI 预打开目录须存在（数据库所在目录）
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  // 1. 加载 backend.wasm
  logger.info('loading wasm module', { path: config.wasmPath });
  const runtime = await WasmRuntime.load(config.wasmPath, ROOT);
  logger.info('wasm module loaded', { version: runtime.version });

  // 2. 数据库迁移（宿主启动时自动初始化；有待执行迁移时自动备份）
  const userVersion = await runMigrations(runtime, {
    root: ROOT,
    dbPath: config.dbPath,
    wasmPath: config.wasmPath,
  });
  logger.info('database ready', { user_version: userVersion, path: config.dbPath });

  // 3. 启动自检（disaster-recovery.md 四）：integrity_check + user_version 与迁移目录一致
  const integ = await runtime.invoke({ op: 'db.query', args: { sql: 'PRAGMA integrity_check;' } });
  const integRow = integ.data?.rows?.[0];
  if (integ.code !== 0 || !integRow || integRow.integrity_check !== 'ok') {
    throw new Error(`startup self-check failed: ${integ.message || 'integrity_check != ok'}`);
  }
  const maxVersion = fs
    .readdirSync(path.join(ROOT, 'db', 'migrations'))
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
    .sort((a, b) => a - b)
    .at(-1) ?? 0;
  if (userVersion !== maxVersion) {
    throw new Error(`startup self-check failed: user_version ${userVersion} != migrations ${maxVersion}`);
  }
  logger.info('startup self-check passed', { user_version: userVersion, integrity: 'ok' });

  // 4. 每日备份任务（启动即做一次；错误仅告警不阻断服务）
  scheduleDailyBackup({ runtime, wasmPath: config.wasmPath, dbPath: config.dbPath });

  // 4.1 通知任务（活动提醒 + 邮件队列；SMTP 未配置时仅提醒、邮件保持待发送）
  // M8：邮件发送器动态读 system_config（官方邮箱 / SMTP），未配置时发送抛错、队列保持待发送
  scheduleNotify({ runtime, sendMail: createMailer({ runtime }) });

  // 5. HTTP 服务
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config }),
    frontendDist: config.frontendDist,
    logger,
  });
  server.listen(config.port, config.host, () => {
    logger.info('host listening', { url: `http://localhost:${config.port}` });
  });
}

main().catch((err) => {
  logger.error('startup failed', { err: err.message });
  process.exit(1);
});
