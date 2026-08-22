# 开发工作流与环境配置

> SACC 报名系统 · 开发指南（[返回总入口](README.md)）

配套 [development.md](development.md)（实现规划）的工程协作约定：环境、工作流、CI、规范。

## 一、开发环境配置

### 工具链（版本要求）

| 工具 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20 LTS | 宿主服务（Node.js）与前端工程 |
| yarn | ≥ 1.22 | 依赖管理 |
| wasi-sdk | ≥ 25（内含 clang，`wasm32-wasi`） | 编译 `backend.wasm` |
| CMake | ≥ 3.24 | 后端构建 |
| wasmtime / wasmer | 最新稳定（可选） | 本地调试 wasm 模块（开发期宿主用 Node 内置 WASI 即可） |
|（可选）Rust | ≥ 1.75 | 宿主迁移方案（wasmtime crate） |

> macOS 备注：Apple clang 不带 `wasm32-wasi` target，须用官方 **wasi-sdk** 工具链。本仓库使用 `wasi-sdk 25.0`（arm64-macos），解压到 `.tools/`（已 gitignore）；构建时通过 `WASI_SDK_PREFIX` 指定，未设置时 CMake 自动探测 `.tools/wasi-sdk-25.0-arm64-macos`。宿主运行时用 Node 内置 WASI（`node:wasi`，preview1）。

### 环境变量（`.env`，不入库）

| 变量 | 说明 | 默认 |
|---|---|---|
| `DB_PATH` | SQLite 文件路径 | `./data/sacc.db` |
| `JWT_SECRET` | 会话 token 密钥 | 必填 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 邮件发送 | 可选（未配则仅站内信） |
| `WASM_PATH` | `backend.wasm` 路径 | `./backend/build/backend.wasm` |
| `FRONTEND_DIST` | 前端构建产物目录 | `./frontend/dist` |
| `HOST` / `PORT` | 宿主监听地址 / 端口 | `0.0.0.0` / `3000` |

### 本地启动

一键启动（推荐）：确保 wasm 已构建 → 启动宿主 → 启动前端（等价于 [scripts/dev.sh](../scripts/dev.sh)）

```
yarn dev
```

分步启动（首次先安装依赖：根目录 `yarn install`，经 workspaces 统一管理 host / frontend）：

```
# 安装依赖（根目录一次即可）
yarn install

# 后端（native 目标，直接跑单测）
cd backend && cmake -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build && ctest

# 编译 wasm
cmake --build build --target backend_wasm

# 宿主服务（开发模式，自动加载 wasm；宿主零依赖，无需安装）
cd host && yarn dev

# 前端（Vite 开发服务器，`/api` 代理到宿主）
cd frontend && yarn dev
```

- 数据库由迁移脚本在宿主启动时自动初始化（`PRAGMA user_version` 顺序执行，幂等）
- 开发期 `DB_PATH` 指向本地文件 `./data/sacc.db`，与生产分离
- 宿主亦托管 `FRONTEND_DIST` 构建产物（SPA 回退 `index.html`）

### 编辑器约定

- C++：clang-format（`.clang-format`）、clangd
- 前端：ESLint + Prettier（`.eslintrc` / `.prettierrc`），保存自动格式化
- 统一缩进 2 空格、UTF-8、行尾 LF

## 二、开发工作流

### 分支与提交

- 主干 `main` 保持可发布；功能分支 `feat/<模块>`、修复 `fix/<模块>`
- 提交信息（Conventional Commits）：
  - `feat:` 新功能 · `fix:` 缺陷修复 · `refactor:` 重构 · `docs:` 文档 · `chore:` 工程杂项
  - 示例：`feat(auth): 登录失败锁定与密码重置`
- 禁止直接向 `main` 推送（PR + 评审后合入）

### 接口开发约定（契约先行）

1. 先定义接口契约：路径、`{ code, data, message }`、错误码（401 未登录 / 403 无权限 / 409 名额满等）
2. 后端 wasm 实现 → 宿主暴露 HTTP → 前端按契约对接
3. 错误码统一登记在 `host/src/errors.js`（后端）与 `frontend/src/api/errors.js`（前端），两侧同步

### 测试工作流

统一入口：根目录 `yarn test`（等价于 [scripts/test.sh](../scripts/test.sh)），一键执行全部测试层，本地与 CI 共用同一入口。

| 层 | 位置 | 触发 |
|---|---|---|
| C++ 单元测试（状态机 / 权限 / 防超卖） | `backend/test/` | `yarn test` 内置 `ctest`，提交前必跑 |
| 宿主集成测试（wasm 调用 + 迁移 + HTTP） | `host/test/` | `yarn test` 内置 `node --test host/test/smoke.test.mjs`，本地 + CI |
| 前端构建冒烟（单测待 M7） | `frontend/` | `yarn test` 内置 `yarn workspace sacc-frontend build` |
| 前端 E2E（Playwright，报名 / 审核 / 签到主路径） | `frontend/e2e/`（规划中，M7） | 待实现 |

- `yarn test` 执行顺序：backend native 构建 + `ctest` → 编译 `backend.wasm` → 宿主集成测试 → 前端构建
- 仅跑单层：`yarn backend:test`（需先 `yarn backend:build`）、`yarn host:test`（需先 `yarn backend:wasm`）
- 关键业务（名额、状态机、权限）要求测试先行或随功能提交

## 三、CI / CD 流水线

```mermaid
flowchart LR
    PUSH[push / PR] --> B[构建 backend.wasm]
    B --> T1[native 单测 ctest]
    T1 --> T2[宿主集成测试]
    T2 --> F[前端 lint + build]
    F --> E2E[Playwright E2E]
    E2E --> ART[发布产物<br/>backend.wasm + host + dist]
    ART --> DEPLOY[部署：单实例 + 备份任务]
```

- 主分支合入触发完整流水线；PR 触发构建 + 单测（快速反馈）
- 产物版本号与 git tag 对应（`v0.1.0`）
- **当前状态**：`.github/workflows/ci.yml` 已实现「构建 backend.wasm → native ctest → 宿主集成测试 → 前端 build」，测试部分由 `yarn test` 统一入口执行（与本地一致）；E2E、发布产物与部署步骤待后续里程碑（M7）补齐

## 四、协作与评审

- PR 描述引用关联文档 / 问题，改动对照 [development.md](development.md) 验收标准
- 评审要点：状态机转移完整、软删语义、权限递归、配置变更进 `audit_log`
- **文档同步**：改动表结构 / 状态机 / 接口契约时，必须同步 `src/docs/` 对应文档，避免设计与实现漂移

## 五、发布与运维

- 部署形态：单实例（宿主进程 + wasm 模块 + `sacc.db`），见 [wasm.md](backend/wasm.md) 部署章节
- 备份：定时 SQLite backup API 生成备份文件
- 监控：宿主日志（结构化）+ 前端指标（见 [data-optimization.md](frontend/data-optimization.md) 监控章节）
