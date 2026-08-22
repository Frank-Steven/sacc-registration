// git pre-commit hook 拦截验证（docs/host-jsdoc.md §4）
// 在当前仓库内真实暂存文件并执行 .githooks/pre-commit，断言其拦截/放行行为。
// 每次用例 try/finally 清理：git restore --staged + 删除临时文件，不污染暂存区与工作区。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = path.join(ROOT, '.githooks', 'pre-commit');
const TEST_FILE = path.join(ROOT, 'host', 'src', '__hook_typecheck_test.js');

const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
const stage = (file) => run('git', ['add', '--', file]);
const unstage = (file) => run('git', ['restore', '--staged', '--', file]);

test('pre-commit: 暂存含类型错误的 host JS 时拦截（exit != 0 且输出 TS 错误）', () => {
  writeFileSync(TEST_FILE, 'const boom = 1;\nboom.nope;\n');
  try {
    stage(TEST_FILE);
    const r = run('bash', [HOOK]);
    assert.notEqual(r.status, 0, `hook 应拦截，实际 status=${r.status}`);
    assert.match(`${r.stdout}${r.stderr}`, /error TS/, '输出应包含 tsc 类型错误');
  } finally {
    unstage(TEST_FILE);
    rmSync(TEST_FILE, { force: true });
  }
});

test('pre-commit: 类型正确的 host JS 放行（exit 0）', () => {
  writeFileSync(TEST_FILE, 'export const ok = 1;\n');
  try {
    stage(TEST_FILE);
    const r = run('bash', [HOOK]);
    assert.equal(r.status, 0, `hook 应放行，实际 status=${r.status}`);
  } finally {
    unstage(TEST_FILE);
    rmSync(TEST_FILE, { force: true });
  }
});

test('pre-commit: 仅非 host 文件变更时不触发类型检查', () => {
  const doc = path.join(ROOT, 'docs', 'README.md');
  try {
    stage(doc);
    const r = run('bash', [HOOK]);
    assert.equal(r.status, 0, '无 host JS 变更时应直接放行');
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /\[pre-commit\] host typecheck/, '不应触发类型检查');
  } finally {
    unstage(doc);
  }
});
