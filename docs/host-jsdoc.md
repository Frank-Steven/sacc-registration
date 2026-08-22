# 宿主层类型检查（JSDoc + checkJs）维护指南

宿主（`host/`）为 **Node + ESM**，业务逻辑全部在 C++/WASM 内，宿主仅承担 JWT 校验、路由与 wasm 透传，约 950 行薄胶水层。基于此**不引入 TypeScript 编译链**（`-fno-exceptions` 的 wasm 边界是"字符串化 JSON"，TS 编译期类型无法替代运行时防御，迁移收益低于成本），而是启用 **JSDoc + `checkJs`**：零构建成本、VSCode 即时报错、可随时收紧。

## 1. 配置与命令

| 项 | 说明 |
|---|---|
| [host/jsconfig.json](../host/jsconfig.json) | `checkJs: true` + `strict: false`（渐进式，仅拦截明显错误），`include` 覆盖 `src/**/*.js` 与 `test/**/*.mjs` |
| [host/src/wasm-types.d.ts](../host/src/wasm-types.d.ts) | wasm 边界协议类型：`InvokeRequest` / `InvokeResult`（`{ code, data?, message? }`），全项目 JSDoc 引用 |
| 手动检查 | `yarn host:typecheck`（`tsc -p host/jsconfig.json --noEmit`，约 0.7s） |
| 回归 | `yarn test` 的 `scripts/test.sh` 第 [3/5] 步内置 typecheck；提交前由 `.githooks/pre-commit` 自动拦截（见 §4） |

## 2. wasm 边界类型用法（必看）

wasm 调用统一返回 `{ code: number, data?, message? }`，JSDoc 引用方式：

```js
import { WasmRuntime } from '../wasm-runtime/runtime.js';

/** @param {import('../wasm-runtime/runtime.js').WasmRuntime} runtime */
async function doThing(runtime) {
  /** @type {import('../wasm-types.js').InvokeResult} */
  const res = await runtime.invoke({ op: 'db.query', args: { sql: '...', params: [...] } });
  if (res.code !== 0) throw new Error(res.message);
}
```

要点：
- `runtime.invoke` 在 [runtime.js](../host/src/wasm-runtime/runtime.js#L45-L49) 已标注 `@param {InvokeRequest}` / `@returns {InvokeResult}`，调用侧无需重复标注返回值类型，除非需要**收窄 `data` 结构**（此时用 `@type` 断言）。
- 所有宿主 `runtime` 参数一律标注 `import('../wasm-runtime/runtime.js').WasmRuntime`，不要写裸 `any`。
- 宿主内新建的 wasm op 若新增参数约定，先在此文档 §5 或对应设计文档登记，再实现。

## 3. 首轮修复模式（23 处错误分类）

启用 checkJs 后首轮 `tsc --noEmit` 捕获 **23 处**类型错误，全部为「JSDoc 缺注解导致推断不准」或测试代码的类型收窄，**无运行时 bug**。按模式分类如下，新增代码对照检查：

### 3.1 对象选项参数未标 JSDoc → 推断收窄（8 处，TS2339 / TS2353）

解构默认参数 `= {}` 时，TS 会把形参推断为 `{ lookaheadSec?: number }` 这类"只含默认键"的类型，访问 `runtime` / `nowSec` 即报 TS2339（缺属性）或 TS2353（传多余键）。

```js
// ❌ 错误：访问 runtime 报 TS2339
export async function runReminders({ runtime, lookaheadSec = 3600, nowSec } = {}) { ... }

// ✅ 修复：为每个选项参数补 JSDoc（见 host/src/task/notify.js#L15-L22）
/**
 * @param {object} [opts]
 * @param {import('../wasm-runtime/runtime.js').WasmRuntime} [opts.runtime]
 * @param {number} [opts.lookaheadSec]
 * @param {number} [opts.nowSec]
 * @returns {Promise<{activities: number, sent: number}>}
 */
export async function runReminders({ runtime, lookaheadSec = 3600, nowSec } = {}) { ... }
```

受影响：`notify.js` 的 `runReminders` / `flushMailQueue` / `scheduleNotify`。

### 3.2 无默认值的解构参数被推断为必填（7 处，TS2345）

解构对象里**没有默认值**的可选参数（如 `expectedVersion`、`wasmPath`）会被推断为必填，调用方漏传即 TS2345。

```js
// ❌ 错误：调用方不传 wasmPath 报 TS2345（"required in type"）
export async function createBackup({ runtime, wasmPath, dbPath, verify = true, expectedVersion }) {}

// ✅ 修复：JSDoc 标注可选（[opts.xxx]）
/**
 * @param {object} opts
 * @param {WasmRuntime} opts.runtime
 * @param {string} [opts.wasmPath]       // 可选：仅传值才校验备份
 * @param {string} opts.dbPath
 * @param {boolean} [opts.verify]
 * @param {number} [opts.expectedVersion] // 可选：缺省时读 user_version
 */
export async function createBackup({ runtime, wasmPath, dbPath, verify = true, expectedVersion }) {}
```

受影响：`backup.js` 的 `createBackup`、`migrate.js` 的 `runMigrations`。

### 3.3 `server.address()` 联合类型收窄（4 处，TS2339）

`net.Server.address()` 返回 `string | AddressInfo | null`，直接 `.port` 报 TS2339。测试中用内联断言：

```js
const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
```

### 3.4 Promise executor 的 resolve 作 node 回调（4 处，TS2769）

`new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))`：`resolve: (value: unknown) => void` 与 node 的 `listeningListener: () => void` 重载匹配失败。包一层：

```js
await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
```

### 3.5 说明

- 上述 3.3 / 3.4 均位于 `host/test/smoke.test.mjs`；运行行为与修复前完全一致（已由 `yarn host:test` 验证 11/11 通过）。
- 未启用 `strict` 前，函数返回值、`data` 内部结构等不做强制检查；如需加强某模块，将 `// @ts-check` 保持并逐文件收窄即可（见 §6）。

## 4. 提交前拦截（git hook）

`.githooks/pre-commit` 已版本化，由 `scripts/install-hooks.sh` 通过 `git config core.hooksPath .githooks` 启用（安装一次即可，克隆后需重新执行）。

- 触发条件：暂存区含 `host/**/*.js|mjs` 变更（`--diff-filter=ACM`）
- 动作：`npx tsc -p host/jsconfig.json --noEmit`，失败则 `exit 1` 阻止提交
- 手动安装：`yarn hooks:install`；跳过（不推荐）：`git commit --no-verify`

## 5. 变更 wasm op 签名 / 宿主调用时需同步

| 变更 | 需要同步的位置 |
|---|---|
| 新增/改 wasm op 入参 | 调用处 `runtime.invoke({ op, args })` 的 args 字段 |
| 新增/改返回结构 | 调用处对 `res.data` 的读取（用 `@type` 断言收窄） |
| 改宿主函数签名（含选项参数） | 该函数 JSDoc + 全部调用方（typecheck 会自动发现） |

## 6. 未来收紧方向

- 升级 `jsconfig.json` 到 `"strict": true`（代价：需为全部宿主代码补齐 JSDoc，收益：返回类型、可选链等全量检查）
- 对 `routes.js` 的 handler 增加 `RouteCtx` 结构类型，杜绝 `ctx.params` 空指针类误用
- 若宿主层业务代码显著膨胀（> 3000 行），再评估全量迁移 TypeScript 的性价比
