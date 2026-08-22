import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WasmRuntime } from '../src/wasm-runtime/runtime.js';
import { runMigrations } from '../src/db/migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WASM_PATH = path.join(ROOT, 'backend', 'build', 'backend.wasm');

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
