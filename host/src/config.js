import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 仓库根目录（宿主进程运行目录）
export const ROOT = path.resolve(__dirname, '../..');

// 加载根目录 .env（不入库），已存在的环境变量优先
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const resolvePath = (p) => (p && !path.isAbsolute(p) ? path.resolve(ROOT, p) : p);

export const config = {
  root: ROOT,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  dbPath: resolvePath(process.env.DB_PATH || './data/sacc.db'),
  wasmPath: resolvePath(process.env.WASM_PATH || './backend/build/backend.wasm'),
  frontendDist: resolvePath(process.env.FRONTEND_DIST || './frontend/dist'),
  jwtSecret: process.env.JWT_SECRET || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};
