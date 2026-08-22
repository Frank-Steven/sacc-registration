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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          body = await readJsonBody(req);
        }
        const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
        if (!route) {
          sendJson(res, 404, { code: Errors.NOT_FOUND, message: 'not found' });
          return;
        }
        const out = await route.handler({ query: url.searchParams, body, headers: req.headers });
        sendJson(res, httpStatusFor(out.code), out);
        return;
      }

      serveStatic(req, res, url, frontendDist);
    } catch (err) {
      logger.error('request failed', { err: err.message });
      sendJson(res, 500, { code: Errors.INTERNAL, message: 'internal error' });
    }
  });
}
