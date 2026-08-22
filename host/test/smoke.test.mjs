import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WasmRuntime } from '../src/wasm-runtime/runtime.js';
import { runMigrations } from '../src/db/migrate.js';
import { createRoutes } from '../src/http/routes.js';
import { createServer } from '../src/http/server.js';
import { signJwt, verifyJwt } from '../src/auth/jwt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WASM_PATH = path.join(ROOT, 'backend', 'build', 'backend.wasm');

// 独立临时目录 + 已迁移的 runtime
async function freshRuntime() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sacc-host-'));
  const runtime = await WasmRuntime.load(WASM_PATH, tmp);
  const dbPath = path.join(tmp, 'sacc_test.db');
  const version = await runMigrations(runtime, { root: ROOT, dbPath });
  return { tmp, runtime, version };
}

test('wasm runtime: ping / version', async () => {
  const runtime = await WasmRuntime.load(WASM_PATH, ROOT);
  const res = await runtime.invoke({ op: 'ping' });
  assert.equal(res.code, 0);
  assert.equal(res.data.pong, true);

  const sys = await runtime.invoke({ op: 'sys.version' });
  assert.equal(sys.code, 0);
  assert.equal(sys.data.version, '0.1.0');
});

test('wasm runtime: 非法 JSON 返回错误码而非崩溃', async () => {
  const runtime = await WasmRuntime.load(WASM_PATH, ROOT);
  const res = await runtime.invoke({ op: 'db.query', args: { sql: 'SELECT 1' } });
  assert.equal(res.code, 2001); // db 未打开
});

test('migrations: 空库初始化为版本 1 并建全部表', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sacc-host-'));
  try {
    const runtime = await WasmRuntime.load(WASM_PATH, tmp);
    const dbPath = path.join(tmp, 'sacc_test.db');
    const version = await runMigrations(runtime, { root: ROOT, dbPath });
    assert.equal(version, 1);

    const tables = await runtime.invoke({ op: 'db.tables' });
    assert.equal(tables.code, 0);
    for (const t of ['account', 'user', 'activity', 'form', 'form_field', 'group',
      'activity_group', 'activity_config', 'system_config', 'form_template', 'audit_log',
      'registration', 'registration_data', 'notification', 'subscribe', 'user_role']) {
      assert.ok(tables.data.tables.includes(t), `缺少表 ${t}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('migrations: 重复执行幂等（版本已是最新则跳过）', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sacc-host-'));
  try {
    const runtime = await WasmRuntime.load(WASM_PATH, tmp);
    const dbPath = path.join(tmp, 'sacc_test.db');
    const v1 = await runMigrations(runtime, { root: ROOT, dbPath });
    const v2 = await runMigrations(runtime, { root: ROOT, dbPath });
    assert.equal(v1, 1);
    assert.equal(v2, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('jwt: 签发 / 校验 / 过期 / 篡改 / 错误密钥', () => {
  const secret = 'unit-test-secret';
  const t = signJwt({ uid: 7, username: 'alice' }, secret, 3600);
  const p = verifyJwt(t, secret);
  assert.equal(p.uid, 7);
  assert.equal(p.username, 'alice');
  assert.ok(p.exp > Math.floor(Date.now() / 1000));

  assert.equal(verifyJwt(t, 'wrong-secret'), null);
  assert.equal(verifyJwt(`${t}x`, secret), null);
  assert.equal(verifyJwt('not-a-jwt', secret), null);
  assert.equal(verifyJwt('', secret), null);

  const expired = signJwt({ uid: 7 }, secret, -10);
  assert.equal(verifyJwt(expired, secret), null);
});

test('auth: 注册 / 登录 / 锁定 / 重置 全流程（wasm 层）', async () => {
  const { tmp, runtime } = await freshRuntime();
  try {
    const reg = await runtime.invoke({
      op: 'auth.register',
      args: { username: 'alice', password: 'secret1234', name: 'Alice', email: 'alice@example.com' },
    });
    assert.equal(reg.code, 0);
    const uid = reg.data.uid;
    assert.equal(reg.data.username, 'alice');
    assert.ok(!('password_hash' in reg.data), '不应返回密码哈希');

    const dup = await runtime.invoke({
      op: 'auth.register',
      args: { username: 'alice', password: 'secret1234' },
    });
    assert.equal(dup.code, 409);

    const login = await runtime.invoke({
      op: 'auth.login',
      args: { username: 'alice', password: 'secret1234' },
    });
    assert.equal(login.code, 0);
    assert.equal(login.data.uid, uid);

    for (let i = 0; i < 5; i++) {
      const bad = await runtime.invoke({
        op: 'auth.login',
        args: { username: 'alice', password: 'wrongpass1' },
      });
      assert.equal(bad.code, 401);
    }
    const locked = await runtime.invoke({
      op: 'auth.login',
      args: { username: 'alice', password: 'secret1234' },
    });
    assert.equal(locked.code, 403, '连续失败 5 次后应锁定');

    const me = await runtime.invoke({ op: 'auth.me', args: { uid } });
    assert.equal(me.code, 0);
    assert.equal(me.data.email, 'alice@example.com');

    const req = await runtime.invoke({ op: 'auth.reset_request', args: { email: 'alice@example.com' } });
    assert.equal(req.code, 0);
    assert.ok(req.data.token, 'M1 联调阶段应返回重置令牌');

    const confirm = await runtime.invoke({
      op: 'auth.reset_confirm',
      args: { token: req.data.token, new_password: 'newpass123' },
    });
    assert.equal(confirm.code, 0);

    const relogin = await runtime.invoke({
      op: 'auth.login',
      args: { username: 'alice', password: 'newpass123' },
    });
    assert.equal(relogin.code, 0, '新密码应可登录（锁定已解除）');
    const oldpw = await runtime.invoke({
      op: 'auth.login',
      args: { username: 'alice', password: 'secret1234' },
    });
    assert.equal(oldpw.code, 401, '旧密码应失效');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('auth HTTP: 注册签发 token → me 鉴权 → 未登录 / 假 token 401', async () => {
  const { tmp, runtime } = await freshRuntime();
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config: { jwtSecret: 'http-test-secret' } }),
    frontendDist: path.join(tmp, 'no-dist'),
    logger: { error: () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    const anon = await fetch(`${base}/api/auth/me`);
    assert.equal(anon.status, 401, '未登录访问 /me 应 401');

    const reg = await post('/api/auth/register', { username: 'bob', password: 'secret1234' });
    assert.equal(reg.status, 200);
    const regJson = await reg.json();
    assert.equal(regJson.code, 0);
    const token = regJson.data.token;
    assert.ok(token);

    const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(me.status, 200);
    const meJson = await me.json();
    assert.equal(meJson.code, 0);
    assert.equal(meJson.data.username, 'bob');

    const bad = await fetch(`${base}/api/auth/me`, {
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    assert.equal(bad.status, 401, '假 token 应 401');

    const logout = await post('/api/auth/logout', {});
    assert.equal(logout.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

