import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { logger } from './logger.js';
import { WasmRuntime } from './wasm-runtime/runtime.js';
import { runMigrations } from './db/migrate.js';
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

  // 2. 数据库迁移（宿主启动时自动初始化）
  const userVersion = await runMigrations(runtime, { root: ROOT, dbPath: config.dbPath });
  logger.info('database ready', { user_version: userVersion, path: config.dbPath });

  // 3. HTTP 服务
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
