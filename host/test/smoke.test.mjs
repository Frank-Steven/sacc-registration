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

test('migrations: 空库初始化为最新版本并建全部表', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sacc-host-'));
  try {
    const runtime = await WasmRuntime.load(WASM_PATH, tmp);
    const dbPath = path.join(tmp, 'sacc_test.db');
    const version = await runMigrations(runtime, { root: ROOT, dbPath });
    assert.equal(version, 5);

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
    assert.equal(v1, 5);
    assert.equal(v2, 5);
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
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

test('http M3: 报名 / 候补递补 / 审核 / 通知 / 订阅 / 签到 / 提醒 全链路', async () => {
  const { tmp, runtime } = await freshRuntime();
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config: { jwtSecret: 'http-m3-secret' } }),
    frontendDist: path.join(tmp, 'no-dist'),
    logger: { error: () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const get = (p, headers = {}) => fetch(`${base}${p}`, { headers });
  const post = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  const put = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  const del = (p, headers = {}) => fetch(`${base}${p}`, { method: 'DELETE', headers });

  try {
    // 注册：root / admin_a / user01 / user02 / user03
    const regRoot = await (await post('/api/auth/register', { username: 'root', password: 'secret1234' })).json();
    const rootUid = regRoot.data.user.uid;
    const rootH = { authorization: `Bearer ${regRoot.data.token}` };
    const regAdmin = await (await post('/api/auth/register', { username: 'admin_a', password: 'secret1234' })).json();
    const adminUid = regAdmin.data.user.uid;
    const adminH = { authorization: `Bearer ${regAdmin.data.token}` };
    const regU1 = await (await post('/api/auth/register', { username: 'user01', password: 'secret1234', name: 'Alice' })).json();
    const u1H = { authorization: `Bearer ${regU1.data.token}` };
    const regU2 = await (await post('/api/auth/register', { username: 'user02', password: 'secret1234', name: 'Bob' })).json();
    const u2H = { authorization: `Bearer ${regU2.data.token}` };

    await runtime.invoke({
      op: 'db.exec',
      args: { sql: `INSERT INTO user_role (uid, role_id, group_id) VALUES (${rootUid}, 1, NULL);` },
    });
    const g = await (await post('/api/admin/groups', { name: 'M3Group' }, rootH)).json();
    assert.equal(g.code, 0);
    assert.equal((await (await post('/api/admin/roles/2/users', { target_uid: adminUid, group_id: g.data.group_id }, rootH)).json()).code, 0);

    // 活动：need_review / allow_modify / max_slots=1；报名窗口已开；活动 30 分钟后"开始"（供提醒任务）
    const now = Math.floor(Date.now() / 1000);
    const act = await (await post('/api/admin/activities', {
      name: 'M3 Workshop',
      need_review: true,
      allow_modify: true,
      max_slots: 1,
      start_time: now - 60,
      end_time: now + 3600,
    }, rootH)).json();
    assert.equal(act.code, 0);
    const act1 = act.data.activity_id;
    assert.equal((await (await post(`/api/admin/activities/${act1}/groups/${g.data.group_id}`, {}, rootH)).json()).code, 0);
    assert.equal((await (await put(`/api/admin/activities/${act1}`, { status: 1 }, rootH)).json()).code, 0);

    // 表单 + 字段（姓名必填 min_length=2；邮箱 regex）
    const form = await (await post(`/api/admin/activities/${act1}/forms`, { name: '报名表' }, adminH)).json();
    assert.equal(form.code, 0);
    const fName = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, {
      field_key: 'student_name', field_label: '姓名', field_type: 0, is_required: true,
      validation: '{"min_length":2}',
    }, adminH)).json();
    assert.equal(fName.code, 0);
    const fEmail = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, {
      field_key: 'email_addr', field_label: '邮箱', field_type: 0,
      validation: '{"regex":"^[^@]+@[^@]+\\\\.com$"}',
    }, adminH)).json();
    assert.equal(fEmail.code, 0);

    // user01 报名：创建草稿 → 保存 → 提交 → 待审核
    const r1 = await (await post(`/api/activities/${act1}/registration`, {}, u1H)).json();
    assert.equal(r1.code, 0);
    const rid1 = r1.data.registration_id;
    assert.equal(r1.data.status, 0);
    // 重复创建 → 409
    assert.equal((await (await post(`/api/activities/${act1}/registration`, {}, u1H)).json()).code, 409);
    const fieldsOk = (name, email) => ({
      fields: [
        { field_id: fName.data.field_id, value: name },
        { field_id: fEmail.data.field_id, value: email },
      ],
      current_step: 1,
    });
    assert.equal((await (await put(`/api/me/registrations/${rid1}`, fieldsOk('Alice', 'a@b.com'), u1H)).json()).code, 0);
    const sub1 = await (await post(`/api/me/registrations/${rid1}/submit`, {}, u1H)).json();
    assert.equal(sub1.code, 0);
    assert.equal(sub1.data.status, 1);
    assert.ok(sub1.data.receipt_no.includes('R'));

    // user02 报名 → 满员（max_slots=1）→ 候补 queue_no=1
    const r2 = await (await post(`/api/activities/${act1}/registration`, {}, u2H)).json();
    assert.equal(r2.code, 0);
    const rid2 = r2.data.registration_id;
    assert.equal((await (await put(`/api/me/registrations/${rid2}`, fieldsOk('Bob', 'b@c.com'), u2H)).json()).code, 0);
    const sub2 = await (await post(`/api/me/registrations/${rid2}/submit`, {}, u2H)).json();
    assert.equal(sub2.code, 0);
    assert.equal(sub2.data.status, 5);
    assert.equal(sub2.data.queue_no, 1);

    // 本人报名列表 / 详情
    const mine = await (await get('/api/me/registrations', u1H)).json();
    assert.equal(mine.code, 0);
    assert.equal(mine.data.total, 1);
    const det1 = await (await get(`/api/me/registrations/${rid1}`, u1H)).json();
    assert.equal(det1.code, 0);
    assert.equal(det1.data.items.length, 2);

    // 管理名单（admin_a 在授权范围；未授权 403 在 M2 已覆盖）
    const list = await (await get(`/api/admin/activities/${act1}/registrations`, adminH)).json();
    assert.equal(list.code, 0);
    assert.ok(list.data.total >= 2);

    // 审核 user01 驳回 → 释放名额 → user02 同步递补为待审核（queue_no 清空）
    assert.equal((await (await post(`/api/admin/registrations/${rid1}/review`, { approve: false, review_remark: '材料不全' }, adminH)).json()).code, 0);
    const det2 = await (await get(`/api/me/registrations/${rid2}`, u2H)).json();
    assert.equal(det2.code, 0);
    assert.equal(det2.data.registration.status, 1);
    assert.ok(det2.data.registration.queue_no === null);
    // user01 重新提交（allow_modify）：满员（user02 待审核占唯一名额）→ 转候补
    const resub = await (await post(`/api/me/registrations/${rid1}/submit`, {}, u1H)).json();
    assert.equal(resub.code, 0);
    assert.equal(resub.data.status, 5);
    assert.equal(resub.data.queue_no, 1);
    // 审核 user02 通过（供签到）；user01 保持候补
    assert.equal((await (await post(`/api/admin/registrations/${rid2}/review`, { approve: true }, adminH)).json()).code, 0);
    const det2b = await (await get(`/api/me/registrations/${rid2}`, u2H)).json();
    assert.equal(det2b.data.registration.status, 2);

    // 通知：报名成功 / 驳回 / 递补 / 审核通过
    const notif = await (await get('/api/me/notifications', u1H)).json();
    assert.equal(notif.code, 0);
    assert.ok(notif.data.total >= 2);
    const unread = await (await get('/api/me/notifications/unread-count', u1H)).json();
    assert.equal(unread.code, 0);
    assert.ok(unread.data.count >= 2);
    const nid = notif.data.items[0].notification_id;
    assert.equal((await (await put(`/api/me/notifications/${nid}/read`, {}, u1H)).json()).code, 0);
    assert.equal((await (await put('/api/me/notifications/read-all', {}, u1H)).json()).code, 0);

    // 订阅：add / 重复 409 / mine / remove
    assert.equal((await (await post(`/api/me/subscribe/${act1}`, {}, u2H)).json()).code, 0);
    assert.equal((await (await post(`/api/me/subscribe/${act1}`, {}, u2H)).json()).code, 409);
    const subs = await (await get('/api/me/subscribes', u2H)).json();
    assert.equal(subs.code, 0);
    assert.equal(subs.data.items.length, 1);
    assert.equal((await (await del(`/api/me/subscribe/${act1}`, u2H)).json()).code, 0);

    // 签到：设置动态码密钥 + checkin_mode=2 → 主办方取码 → user02 输码签到
    assert.equal((await (await put('/api/admin/system/config', { key: 'checkin_secret', value: 'smoke-secret-0123456789' }, rootH)).json()).code, 0);
    assert.equal((await (await put(`/api/admin/activities/${act1}/config`, { key: 'checkin_mode', value: '2' }, adminH)).json()).code, 0);
    // 主办方动态码（格式与权限）
    const code = await (await get(`/api/admin/activities/${act1}/checkin-code`, adminH)).json();
    assert.equal(code.code, 0);
    assert.match(code.data.code, /^\d{6}$/);
    assert.ok(code.data.expires_in > 0);
    // 错误码 → 422；正确码 → user02 签到成功
    assert.equal((await (await post('/api/me/checkin/code', { activity_id: act1, code: '000000' }, u2H)).json()).code, 422);
    const code2 = await (await get(`/api/admin/activities/${act1}/checkin-code`, adminH)).json();
    assert.equal((await (await post('/api/me/checkin/code', { activity_id: act1, code: code2.data.code }, u2H)).json()).code, 0);
    // 管理员扫码（凭证号）→ 已签到 → 409；重复签到 409
    assert.equal((await (await post('/api/admin/checkin/receipt', { receipt_no: sub2.data.receipt_no }, adminH)).json()).code, 409);
    assert.equal((await (await post(`/api/admin/registrations/${rid2}/checkin`, {}, adminH)).json()).code, 409);

    // 提醒任务：另建"30 分钟后开始"的活动 act2（报名窗口未开，不影响 act1 报名链路）。
    // 其 start_time ∈ (now, now+1h) → 订阅者生成 type 2 提醒；幂等重跑不重复。
    const { runReminders } = await import('../src/task/notify.js');
    const u3 = await (await post('/api/auth/register', { username: 'user03', password: 'secret1234', name: 'Cara' })).json();
    const u3H = { authorization: `Bearer ${u3.data.token}` };
    const act2 = await (await post('/api/admin/activities', {
      name: 'M3 Reminder Event',
      need_review: false,
      max_slots: 0,
      start_time: now + 1800,
      end_time: now + 7200,
    }, rootH)).json();
    assert.equal(act2.code, 0);
    const act2id = act2.data.activity_id;
    assert.equal((await (await put(`/api/admin/activities/${act2id}`, { status: 1 }, rootH)).json()).code, 0);
    await (await post(`/api/me/subscribe/${act2id}`, {}, u1H)).json(); // 订阅者（u1 已在 act1 候补，不影响）
    await (await post(`/api/me/subscribe/${act2id}`, {}, u2H)).json();
    await (await post(`/api/me/subscribe/${act2id}`, {}, u3H)).json(); // 订阅者（未报名）
    const r1st = await runReminders({ runtime });
    assert.ok(r1st.sent >= 3, `首次提醒应覆盖 3 个目标（u1/u2/u3 订阅），实际 ${r1st.sent}`);
    const r2nd = await runReminders({ runtime });
    assert.equal(r2nd.sent, 0, '幂等：重复扫描不再生成');
    const type2 = await runtime.invoke({
      op: 'db.query',
      args: { sql: 'SELECT COUNT(*) AS c FROM notification WHERE type = 2;' },
    });
    assert.ok(type2.data.rows[0].c >= 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('http M4: 导出（分块/CSV）与统计（看板/趋势/跨活动）全链路', async () => {
  const { tmp, runtime } = await freshRuntime();
  const server = createServer({
    runtime,
    routes: createRoutes({ runtime, config: { jwtSecret: 'http-m4-secret' } }),
    frontendDist: path.join(tmp, 'no-dist'),
    logger: { error: () => {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const get = (p, headers = {}) => fetch(`${base}${p}`, { headers });
  const post = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  const put = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });

  try {
    // 注册：root 超管 / admin_a（role2）/ user01、user02 报名 / user03（role3 只读）/ outsider
    const regRoot = await (await post('/api/auth/register', { username: 'root', password: 'secret1234' })).json();
    const rootUid = regRoot.data.user.uid;
    const rootH = { authorization: `Bearer ${regRoot.data.token}` };
    const regAdmin = await (await post('/api/auth/register', { username: 'admin_a', password: 'secret1234' })).json();
    const adminUid = regAdmin.data.user.uid;
    const adminH = { authorization: `Bearer ${regAdmin.data.token}` };
    const regU1 = await (await post('/api/auth/register', { username: 'user01', password: 'secret1234', name: '张三' })).json();
    const u1H = { authorization: `Bearer ${regU1.data.token}` };
    const regU2 = await (await post('/api/auth/register', { username: 'user02', password: 'secret1234', name: '李四,"好"' })).json();
    const u2H = { authorization: `Bearer ${regU2.data.token}` };
    const regU3 = await (await post('/api/auth/register', { username: 'user03', password: 'secret1234' })).json();
    const u3H = { authorization: `Bearer ${regU3.data.token}` };
    const regOut = await (await post('/api/auth/register', { username: 'outsider', password: 'secret1234' })).json();
    const outH = { authorization: `Bearer ${regOut.data.token}` };

    await runtime.invoke({
      op: 'db.exec',
      args: { sql: `INSERT INTO user_role (uid, role_id, group_id) VALUES (${rootUid}, 1, NULL);` },
    });
    const g = await (await post('/api/admin/groups', { name: 'M4Group' }, rootH)).json();
    assert.equal(g.code, 0);
    const gid = g.data.group_id;
    // admin_a：role2 可写；user03：role3 只读（导出 403 / 统计 200，决策 2）
    assert.equal((await (await post('/api/admin/roles/2/users', { target_uid: adminUid, group_id: gid }, rootH)).json()).code, 0);
    assert.equal((await (await post('/api/admin/roles/3/users', { target_uid: regU3.data.user.uid, group_id: gid }, rootH)).json()).code, 0);

    // 活动：need_review=false（提交即通过）max_slots=2，绑 g1 并发布
    const now = Math.floor(Date.now() / 1000);
    const act = await (await post('/api/admin/activities', {
      name: 'M4 Expo',
      need_review: false,
      max_slots: 2,
      start_time: now - 3600,
      end_time: now + 86400,
    }, rootH)).json();
    assert.equal(act.code, 0);
    const act1 = act.data.activity_id;
    assert.equal((await (await post(`/api/admin/activities/${act1}/groups/${gid}`, {}, rootH)).json()).code, 0);
    assert.equal((await (await put(`/api/admin/activities/${act1}`, { status: 1 }, rootH)).json()).code, 0);

    // 表单 + 字段：姓名(文本) / 性别(单选) / 爱好(多选) / 隐藏列(is_visible=false)
    const form = await (await post(`/api/admin/activities/${act1}/forms`, { name: '报名表' }, adminH)).json();
    assert.equal(form.code, 0);
    const fName = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, { field_key: 'name_field', field_label: '姓名', field_type: 0, is_required: true }, adminH)).json();
    assert.equal(fName.code, 0);
    const fGen = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, { field_key: 'gender', field_label: '性别', field_type: 2, options: '["男","女"]' }, adminH)).json();
    assert.equal(fGen.code, 0);
    const fHob = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, { field_key: 'hobby', field_label: '爱好', field_type: 3, options: '["篮球","足球","羽毛球"]' }, adminH)).json();
    assert.equal(fHob.code, 0);
    const fHidden = await (await post(`/api/admin/forms/${form.data.form_id}/fields`, { field_key: 'hidden_f', field_label: '隐藏列', field_type: 0, is_visible: false }, adminH)).json();
    assert.equal(fHidden.code, 0);

    // user01 / user02 报名并提交（need_review=false → 已通过 status=2）
    const submit = async (token, fields) => {
      const r = await (await post(`/api/activities/${act1}/registration`, {}, token)).json();
      assert.equal(r.code, 0);
      assert.equal((await (await put(`/api/me/registrations/${r.data.registration_id}`, { fields, current_step: 1 }, token)).json()).code, 0);
      return (await (await post(`/api/me/registrations/${r.data.registration_id}/submit`, {}, token)).json());
    };
    const s1 = await submit(u1H, [
      { field_id: fName.data.field_id, value: '张三' },
      { field_id: fGen.data.field_id, value: '男' },
      { field_id: fHob.data.field_id, value: '["篮球","羽毛球"]' },
    ]);
    assert.equal(s1.code, 0);
    assert.equal(s1.data.status, 2);
    const s2 = await submit(u2H, [
      { field_id: fName.data.field_id, value: '李四,"好"' },
      { field_id: fGen.data.field_id, value: '女' },
      { field_id: fHob.data.field_id, value: '["篮球"]' },
    ]);
    assert.equal(s2.code, 0);
    assert.equal(s2.data.status, 2);

    // ===== 分块导出（registration.export）=====
    const exp = await (await get(`/api/admin/activities/${act1}/export?limit=100`, adminH)).json();
    assert.equal(exp.code, 0);
    assert.equal(exp.data.total, 2);
    const keys = exp.data.columns.map((c) => c.key);
    assert.ok(keys.includes('name_field') && keys.includes('gender') && keys.includes('hobby'), '可见动态列应在');
    assert.ok(!keys.includes('hidden_f'), '隐藏字段不应出列');
    assert.ok(keys.indexOf('registration_id') < keys.indexOf('name_field'), '固定列在动态列前');
    const row1 = exp.data.rows.find((r) => r.fields.name_field === '张三');
    assert.ok(row1, '张三行应在');
    assert.equal(row1.fields.gender, '男');
    assert.equal(row1.fields.hobby, '篮球;羽毛球');
    assert.equal(exp.data.next_cursor, 0);

    // 分块连续性（limit=1）：cursor 递进不重不漏
    const p1 = await (await get(`/api/admin/activities/${act1}/export?limit=1`, adminH)).json();
    assert.equal(p1.code, 0);
    assert.equal(p1.data.rows.length, 1);
    const c1 = p1.data.rows[0].registration_id;
    assert.equal(p1.data.next_cursor, c1);
    const p2 = await (await get(`/api/admin/activities/${act1}/export?limit=1&cursor=${c1}`, adminH)).json();
    assert.equal(p2.code, 0);
    assert.equal(p2.data.rows.length, 1);
    assert.notEqual(p2.data.rows[0].registration_id, c1);
    assert.equal(p2.data.next_cursor, 0);

    // 筛选 keyword（user.name）；非法 cursor → 422
    const kw = await (await get(`/api/admin/activities/${act1}/export?keyword=${encodeURIComponent('张三')}`, adminH)).json();
    assert.equal(kw.code, 0);
    assert.equal(kw.data.total, 1);
    assert.equal((await (await get(`/api/admin/activities/${act1}/export?cursor=-1`, adminH)).json()).code, 422);

    // ===== CSV 下载（registration.export_csv）：raw 内容 + Content-Disposition + BOM =====
    const csvRes = await fetch(`${base}/api/admin/activities/${act1}/export.csv`, { headers: adminH });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-type'), /^text\/csv/);
    assert.match(csvRes.headers.get('content-disposition'), /attachment; filename="registrations_/);
    // BOM 断言在字节层（TextDecoder 剥 BOM，text() 不可见）
    const csvBuf = Buffer.from(await csvRes.arrayBuffer());
    assert.ok(csvBuf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), 'CSV 应带 UTF-8 BOM 字节');
    const csv = csvBuf.toString('utf8').slice(1);
    assert.ok(csv.includes('凭证号'), '应含表头');
    assert.ok(csv.includes('篮球;羽毛球'), '多选标签分号连接');
    assert.ok(csv.includes('"李四,""好"""'), 'RFC 4180 逗号/引号转义');
    assert.ok(!csv.includes('隐藏列'), '隐藏字段不出列');

    // ===== 看板统计（registration.stats）=====
    const stats = await (await get(`/api/admin/activities/${act1}/stats`, adminH)).json();
    assert.equal(stats.code, 0);
    assert.equal(stats.data.capacity, 2);
    assert.equal(stats.data.taken, 2);
    assert.equal(stats.data.pending, 0);
    assert.equal(stats.data.waitlist, 0);
    assert.equal(stats.data.status_dist.find((s) => s.status === 2).count, 2);
    const genderFd = stats.data.field_dist.find((fd) => fd.field_key === 'gender');
    const hobbyFd = stats.data.field_dist.find((fd) => fd.field_key === 'hobby');
    assert.ok(genderFd && hobbyFd, '字段分布应含单选/多选');
    assert.equal(genderFd.items.find((i) => i.value === '男').count, 1);
    assert.equal(genderFd.items.find((i) => i.value === '女').count, 1);
    assert.equal(hobbyFd.items.find((i) => i.value === '篮球').count, 2);
    assert.equal(hobbyFd.items.find((i) => i.value === '羽毛球').count, 1);

    // ===== 每日趋势（registration.trend，7 天补 0）=====
    const trend = await (await get(`/api/admin/activities/${act1}/trend?days=7`, adminH)).json();
    assert.equal(trend.code, 0);
    assert.equal(trend.data.items.length, 7);
    const trendTotal = trend.data.items.reduce((a, it) => a + it.count, 0);
    assert.equal(trendTotal, 2);

    // ===== 跨活动统计（activity.stats，分组范围过滤）=====
    const aStats = await (await get('/api/admin/activities/stats', adminH)).json();
    assert.equal(aStats.code, 0);
    assert.equal(aStats.data.total, 1, 'admin_a 范围仅 M4 Expo');
    assert.equal(aStats.data.rows[0].name, 'M4 Expo');
    assert.equal(aStats.data.rows[0].total, 2);
    assert.ok((await (await get('/api/admin/activities/stats', rootH)).json()).data.total >= 1, '超管全范围');
    assert.equal((await (await get('/api/admin/activities/stats?keyword=none', adminH)).json()).data.total, 0);

    // ===== 权限（决策 2）：导出 manage / 统计 read；活动不存在 404 =====
    assert.equal((await (await get(`/api/admin/activities/${act1}/export`, outH)).json()).code, 403);
    assert.equal((await (await get(`/api/admin/activities/${act1}/export`, u3H)).json()).code, 403, 'role3 只读不可导出');
    assert.equal((await (await get(`/api/admin/activities/${act1}/stats`, u3H)).json()).code, 0, 'role3 可读统计');
    assert.equal((await (await get(`/api/admin/activities/${act1}/stats`, outH)).json()).code, 403);
    assert.equal((await (await get('/api/admin/activities/stats', outH)).json()).code, 403);
    assert.equal((await (await get('/api/admin/activities/999999/stats', adminH)).json()).code, 404);

    // ===== 审计：导出动作各写一次（JSON 分块首块 + CSV）=====
    const audit = await (await get('/api/admin/audit-logs', rootH)).json();
    assert.equal(audit.code, 0);
    const exportAudits = audit.data.items.filter((a) => a.action === 'export_registration');
    assert.ok(exportAudits.length >= 2, `JSON+CSV 导出各写审计，实际 ${exportAudits.length}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(tmp, { recursive: true, force: true });
  }
});

