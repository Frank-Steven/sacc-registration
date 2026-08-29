#!/usr/bin/env node
/**
 * 引导脚本：创建第一个超级管理员
 *
 * 用法：
 *   node scripts/bootstrap-admin.js
 *
 * 流程：
 *   1. 加载 backend.wasm + 初始化数据库 + 执行迁移
 *   2. 注册新用户（如用户名已存在则跳过注册）
 *   3. 将该用户提升为超级管理员（role_id=1，全范围）
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function loadRuntime() {
  const { WasmRuntime } = await import('../host/src/wasm-runtime/runtime.js');
  const wasmPath = path.join(ROOT, 'backend', 'build', 'backend.wasm');
  if (!fs.existsSync(wasmPath)) {
    console.error(`错误：找不到 ${wasmPath}`);
    console.error('请先编译后端 WASM：cmake -S backend -B backend/build && cmake --build backend/build --target backend_wasm');
    process.exit(1);
  }
  return WasmRuntime.load(wasmPath, ROOT);
}

async function runMigrations(runtime) {
  const dir = path.join(ROOT, 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d{4}_/.test(f)).sort();
  const dbPath = process.env.DB_PATH || './data/sacc.db';
  const wasmDbPath = runtime.relPath(path.resolve(ROOT, dbPath));

  const init = await runtime.invoke({ op: 'db.init', args: { path: wasmDbPath } });
  if (init.code !== 0) throw new Error(`db.init 失败: ${init.message}`);

  let current = init.data.user_version;
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const res = await runtime.invoke({ op: 'db.migrate', args: { sql, version } });
    if (res.code !== 0) throw new Error(`迁移 ${file} 失败: ${res.message}`);
    current = res.data.user_version;
  }
  return current;
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  console.log('=== SACC 报名系统 · 创建第一个超级管理员 ===\n');

  // 1. 加载 WASM + 初始化数据库
  console.log('正在加载后端模块...');
  const runtime = await loadRuntime();
  console.log('正在初始化数据库...');
  const version = await runMigrations(runtime);
  console.log(`数据库就绪（user_version=${version}）\n`);

  // 2. 获取用户输入
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const username = await ask(rl, '用户名（3~32 位字母数字下划线）: ');
    const password = await ask(rl, '密码（8~128 位）: ');
    const name = await ask(rl, '显示名称: ');
    console.log('');

    if (!username || !password) {
      console.error('用户名和密码不能为空');
      process.exit(1);
    }

    // 3. 注册用户
    let uid;
    const regResult = await runtime.invoke({
      op: 'auth.register',
      args: { username, password, name: name || username },
    });

    if (regResult.code === 0) {
      uid = regResult.data.uid;
      console.log(`用户注册成功（uid=${uid}）`);
    } else if (regResult.code === 409) {
      // 用户名已存在，尝试查询 uid
      console.log('用户名已存在，尝试查询已有用户...');
      const queryResult = await runtime.invoke({
        op: 'db.query',
        args: { sql: 'SELECT uid FROM account WHERE username = ?;', params: [username] },
      });
      if (queryResult.code !== 0 || !queryResult.data?.rows?.length) {
        console.error('查询用户失败:', queryResult.message || '用户不存在');
        process.exit(1);
      }
      uid = queryResult.data.rows[0].uid;
      console.log(`找到已有用户（uid=${uid}）`);
    } else {
      console.error('注册失败:', regResult.message);
      process.exit(1);
    }

    // 4. 检查是否已有超级管理员角色
    const roleCheck = await runtime.invoke({
      op: 'db.query',
      args: {
        sql: 'SELECT role_id FROM user_role WHERE uid = ? AND role_id = 1;',
        params: [uid],
      },
    });

    if (roleCheck.code === 0 && roleCheck.data?.rows?.length > 0) {
      console.log('该用户已经是超级管理员，无需重复授权');
    } else {
      // 5. 授予超级管理员角色
      const grantResult = await runtime.invoke({
        op: 'db.exec',
        args: {
          sql: 'INSERT INTO user_role (uid, role_id, group_id) VALUES (?, 1, NULL);',
        },
      });
      // 需要参数化，但 db.exec 不支持参数，使用 db.exec_params
      const grantResult2 = await runtime.invoke({
        op: 'db.exec_params',
        args: {
          sql: 'INSERT INTO user_role (uid, role_id, group_id) VALUES (?, 1, NULL);',
          params: [uid],
        },
      });

      if (grantResult2.code === 0) {
        console.log(`已将用户 ${username}（uid=${uid}）提升为超级管理员`);
      } else {
        console.error('授权失败:', grantResult2.message);
        process.exit(1);
      }
    }

    console.log('\n=== 完成 ===');
    console.log(`用户 "${username}" 现在拥有超级管理员权限。`);
    console.log('请使用该账号登录系统管理后台。');

  } finally {
    rl.close();
  }
}

main().catch(err => {
  console.error('执行出错:', err.message);
  process.exit(1);
});
