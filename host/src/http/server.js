import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Errors, httpStatusFor } from '../errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// 请求体上限（1MB）：防未认证大请求耗尽内存
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      // 超限后停止累积、继续读完剩余数据（不提前销毁流，保证 413 响应可达）
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new BodyTooLargeError();
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// 路由 pattern 编译：支持 RegExp（M1 原有）与字符串路径（含 :param，M2 起）
// 返回 { exec(pathname) -> params|null }；RegExp 无命名参数，命中返回 {}。
function compilePattern(pattern) {
  if (pattern instanceof RegExp) {
    return { exec: (pathname) => (pattern.test(pathname) ? {} : null) };
  }
  const names = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const re = new RegExp(`^${src}$`);
  return {
    exec: (pathname) => {
      const m = re.exec(pathname);
      if (!m) return null;
      const params = {};
      names.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return params;
    },
  };
}

// 静态资源托管（前端构建产物，SPA 回退到 index.html）
function serveStatic(req, res, url, dist) {
  if (!fs.existsSync(dist)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('frontend 未构建，请运行 `cd frontend && yarn dev`（开发模式走 Vite 代理）');
    return;
  }
  let filePath = path.normalize(path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!filePath.startsWith(dist)) {
    sendJson(res, 403, { code: Errors.FORBIDDEN, message: 'forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(dist, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { code: Errors.NOT_FOUND, message: 'not found' });
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

export function createServer({ runtime, routes, frontendDist, logger }) {
  const compiledRoutes = routes.map((r) => ({ ...r, match: compilePattern(r.pattern) }));
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          body = await readJsonBody(req);
        }
        let params = null;
        const route = compiledRoutes.find(
          (r) => r.method === req.method && (params = r.match.exec(url.pathname)),
        );
        if (!route) {
          sendJson(res, 404, { code: Errors.NOT_FOUND, message: 'not found' });
          return;
        }
        const out = await route.handler({ query: url.searchParams, body, headers: req.headers, params });
        sendJson(res, httpStatusFor(out.code), out);
        return;
      }

      serveStatic(req, res, url, frontendDist);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        sendJson(res, 413, { code: Errors.PAYLOAD_TOO_LARGE, message: '请求体过大' });
        return;
      }
      logger.error('request failed', { err: err.message });
      sendJson(res, 500, { code: Errors.INTERNAL, message: 'internal error' });
    }
  });
}
