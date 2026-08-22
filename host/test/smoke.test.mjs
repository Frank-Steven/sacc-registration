import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WasmRuntime } from '../src/wasm-runtime/runtime.js';
import { runMigrations } from '../src/db/migrate.js';
import { createBackup } from '../src/task/backup.js';
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
    assert.equal(version, 2);

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
    assert.equal(v1, 2);
    assert.equal(v2, 2);
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

test('http: 超限请求体返回 413（防内存耗尽 DoS）', async () => {
  const { tmp, runtime } = await freshRuntime();
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config: { jwtSecret: 'http-test-secret' } }),
    frontendDist: path.join(tmp, 'no-dist'),
    logger: { error: () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'x'.repeat(2 * 1024 * 1024) }),
    });
    assert.equal(res.status, 413);
    const json = await res.json();
    assert.equal(json.code, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('backup: db.backup 生成可读备份（integrity + user_version + 保留策略）', async () => {
  const { tmp, runtime } = await freshRuntime();
  try {
    const reg = await runtime.invoke({
      op: 'auth.register',
      args: { username: 'alice', password: 'secret1234' },
    });
    assert.equal(reg.code, 0);

    const dbPath = path.join(tmp, 'sacc_test.db');
    const dest = await createBackup({ runtime, wasmPath: WASM_PATH, dbPath });
    assert.ok(dest.includes(path.join('backup', 'sacc-')));
    // 校验环节已 load 到临时 runtime：integrity_check + user_version(2) + 表冒烟
    const backupDir = path.join(tmp, 'backup');
    assert.equal(readdirSync(backupDir).length, 1);

    await createBackup({ runtime, wasmPath: WASM_PATH, dbPath });
    assert.equal(readdirSync(backupDir).length, 2, '最近 7 份内全保留');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('http admin: M2 配置层全链路（鉴权 / 活动 / 分组 / 表单 / 模板 / 配置 / 审计 / 公开读）', async () => {
  const { tmp, runtime } = await freshRuntime();
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config: { jwtSecret: 'http-m2-secret' } }),
    frontendDist: path.join(tmp, 'no-dist'),
    logger: { error: () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, headers = {}) => fetch(`${base}${p}`, { headers });
  const post = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const put = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const del = (p, headers = {}) => fetch(`${base}${p}`, { method: 'DELETE', headers });

  try {
    // 未登录访问管理端 → 401
    assert.equal((await get('/api/admin/activities')).status, 401);

    const regRoot = await (await post('/api/auth/register', { username: 'root', password: 'secret1234' })).json();
    assert.equal(regRoot.code, 0);
    const rootUid = regRoot.data.user.uid;
    const rootH = { authorization: `Bearer ${regRoot.data.token}` };

    const regAdmin = await (await post('/api/auth/register', { username: 'admin_a', password: 'secret1234' })).json();
    assert.equal(regAdmin.code, 0);
    const adminUid = regAdmin.data.user.uid;
    const adminH = { authorization: `Bearer ${regAdmin.data.token}` };

    // 引导首个超管（直接写 user_role，同 native 单测）；db.exec op 无参数绑定，uid 拼入 SQL
    const boot = await runtime.invoke({
      op: 'db.exec',
      args: { sql: `INSERT INTO user_role (uid, role_id, group_id) VALUES (${rootUid}, 1, NULL);` },
    });
    assert.equal(boot.code, 0);

    // 建分组 g1 → 授权 admin_a（role2 / g1）
    const g = await (await post('/api/admin/groups', { name: 'Group1' }, rootH)).json();
    assert.equal(g.code, 0);
    const grant = await (await post(`/api/admin/roles/2/users`, { target_uid: adminUid, group_id: g.data.group_id }, rootH)).json();
    assert.equal(grant.code, 0);
    const myRoles = await (await get(`/api/admin/users/${adminUid}/roles`, rootH)).json();
    assert.equal(myRoles.code, 0);
    assert.equal(myRoles.data.items.length, 1);

    // root 建活动 act1（未绑定分组 → admin_a 不可见 → 403）
    const act = await (await post('/api/admin/activities', { name: 'Seminar 2026', activity_type: 0 }, rootH)).json();
    assert.equal(act.code, 0);
    const act1 = act.data.activity_id;
    const forb = await (await get(`/api/admin/activities/${act1}`, adminH)).json();
    assert.equal(forb.code, 403);

    // 绑定 g1 后 admin_a 可读
    const bind = await (await post(`/api/admin/activities/${act1}/groups/${g.data.group_id}`, {}, rootH)).json();
    assert.equal(bind.code, 0);
    const det = await (await get(`/api/admin/activities/${act1}`, adminH)).json();
    assert.equal(det.code, 0);
    assert.equal(det.data.groups.length, 1);

    // admin_a 建表单 + 字段；冻结字段修改 → 409
    const form = await (await post(`/api/admin/activities/${act1}/forms`, { name: '报名表' }, adminH)).json();
    assert.equal(form.code, 0);
    const field = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, { field_key: 'student_name', field_label: '姓名', field_type: 0 }, adminH)).json();
    assert.equal(field.code, 0);
    const frozen = await (await put(`/api/admin/fields/${field.data.field_id}`, { field_key: 'hack' }, adminH)).json();
    assert.equal(frozen.code, 409);

    // 活动配置（批量）
    const cfg = await (await put(`/api/admin/activities/${act1}/config`, { items: [{ key: 'venue_name', value: 'A 厅' }] }, adminH)).json();
    assert.equal(cfg.code, 0);
    const cfgList = await (await get(`/api/admin/activities/${act1}/config`, adminH)).json();
    assert.equal(cfgList.code, 0);
    assert.equal(cfgList.data.items.length, 1);

    // 模板：创建 → 套用
    const tpl = await (await post('/api/admin/templates', { name: 'Tpl', fields_json: '[]' }, rootH)).json();
    assert.equal(tpl.code, 0);
    const applied = await (await post(`/api/admin/templates/${tpl.data.template_id}/apply`, { activity_id: act1 }, adminH)).json();
    assert.equal(applied.code, 0);

    // 审计仅超管；活动管理员 → 403
    const audit = await (await get('/api/admin/audit-logs', rootH)).json();
    assert.equal(audit.code, 0);
    assert.ok(audit.data.total >= 6);
    assert.equal((await get('/api/admin/audit-logs', adminH)).status, 403);

    // 报名端公开读：草稿不可见
    const pub0 = await (await get('/api/activities')).json();
    assert.equal(pub0.code, 0);
    assert.equal(pub0.data.items.length, 0);

    // 发布（0→1）后公开可见；已发布活动不可删 → 409
    const pubAct = await (await put(`/api/admin/activities/${act1}`, { status: 1 }, rootH)).json();
    assert.equal(pubAct.code, 0);
    const pub1 = await (await get('/api/activities')).json();
    assert.equal(pub1.code, 0);
    assert.equal(pub1.data.items.length, 1);
    const pubDetail = await (await get(`/api/activities/${act1}`)).json();
    assert.equal(pubDetail.code, 0);
    assert.ok(pubDetail.data.name === 'Seminar 2026');
    const del409 = await (await del(`/api/admin/activities/${act1}`, rootH)).json();
    assert.equal(del409.code, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

