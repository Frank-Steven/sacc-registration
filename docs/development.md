# 开发实现方案

> SACC 报名系统 · 实现规划（[返回总入口](README.md)）· 协作约定见 [dev-guide.md](dev-guide.md)

基于 [overview.md](overview.md) 与前后端设计文档的落地计划。目标：实现可运行的报名系统——后端 C++/WASM + SQLite、宿主服务、前端 React。

## 一、里程碑规划

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M0 工程骨架 | 仓库结构、构建脚本、CI、数据库迁移框架 | `backend.wasm` 空模块可编译、宿主可调用 ✅ 已完成 |
| M1 数据层核心 | 建表 DDL、WASM ABI 骨架、注册 / 登录（哈希 / 锁定 / 重置） | 账号体系可用 ✅ 已完成 |
| M2 配置层 | 活动 / 分组 / 表单 / 字段 / 模板 / 配置、角色与分组权限 | 管理端配置 API |
| M3 报名链路 | 草稿 / 提交 / 防超卖 / 候补递补 / 审核 / 修改取消 / 签到 / 通知 | 报名全流程 API |
| M4 导出统计 | 名单分块导出、聚合统计 | 导出与看板 API |
| M5 前端基础 | Vite + React + antd 工程、路由 / 布局、请求与缓存层 | 报名端可浏览 |
| M6 管理端 | 活动管理（表单设计器）、名单 / 审核 / 签到 / 看板 / 模板 | 管理端可用 |
| M7 系统管理 + 打磨 | 分组 / 账号 / 角色 / 配置中心 / 审计 / 数据治理；响应式与性能优化、测试 | 全功能发布版 |

## 二、工程结构

```
sacc-registration/
├── backend/             # C++ 源码（SQLite 静态编入）
│   ├── CMakeLists.txt   # wasm32-wasi 编译
│   ├── src/             # 业务逻辑（按 config/user/data 分层目录）
│   ├── wasm/            # C ABI 导出接口（wasm_alloc / 各 wasm_* 函数）
│   └── test/            # 单元测试（native 目标下直接测）
├── host/                # 宿主服务（建议 Node.js，瓶颈时换 Rust）
│   ├── http/            # HTTP 路由 + 会话鉴权 + WebSocket
│   ├── wasm-runtime/    # 调用 backend.wasm（写调用串行化）
│   ├── smtp/            # 邮件发送与重试
│   └── task/            # 定时任务（订阅提醒、递补）
├── frontend/            # React 19 + antd 5（Vite）
│   ├── src/pages/       # 路由页面（报名端 / 管理端 / 系统管理端）
│   ├── src/components/  # 复用组件（FormBuilder、FormDesigner 等）
│   ├── src/stores/      # Zustand store
│   ├── src/api/         # axios 服务层（按域拆分）
│   └── src/hooks/       # TanStack Query 封装
├── db/                  # 迁移脚本（PRAGMA user_version 分版本）
└── scripts/             # 构建 / 部署 / 备份脚本
```

## 三、关键实现决策

| 项 | 决策 |
|---|---|
| 宿主语言 | 先 **Node.js**（开发效率），wasm 写并发成瓶颈时迁移 **Rust**（wasmtime） |
| 数据库迁移 | `PRAGMA user_version` 编号 + `db/migrations/NNNN_*.sql`，启动时顺序执行 |
| 接口契约 | 统一 `{ code, data, message }`；错误码集中定义 |
| 时间 / 文本 | 全部 Unix 秒（INTEGER）、UTF-8；删除走软删 |
| 写并发 | 宿主对 wasm 写调用加锁串行化；报名用条件更新防超卖 |
| 测试 | 后端 native 单测（状态机 / 权限 / 防超卖）+ 宿主集成测试 + 前端 E2E（Playwright） |

## 四、后端实现计划（backend/ + db/）

**M1（数据层核心）**
- `db/migrations/0001_init.sql`：全部表 DDL（`activity` 至 `audit_log`，含唯一约束与索引，见 [indexes.md](backend/indexes.md)）
- WASM ABI：`wasm_alloc` / `wasm_free` + JSON 入出参封装（见 [wasm.md](backend/wasm.md)）
- 账号：注册（`account` + `user` 同事务）、登录（`login_fail_count` 锁定至 `lock_until`）、重置（`reset_token` + `reset_expire` 经 `user.email`）
- 安全：PBKDF2-HMAC-SHA256（100k 迭代）哈希在模块内完成（决策见 [auth.md](backend/auth.md)）

**M2（配置层）**
- 活动 CRUD（`activity_type` / `need_review` / `allow_modify` / 软删）
- 分组树：递归 CTE 查询子树、`activity_group` 多对多
- 表单 / 字段：只追加、`field_key` 不可变、软删；`validation` JSON 解析；`form_template` 快照套用
- 配置：`activity_config` / `system_config` 键值读写（`config_type` 类型化）
- 权限：`user_role` 分组范围递归判定（GROUP BY 授权分组展开）

**M3（报名链路）**
- 报名：`(activity_id, uid)` 唯一校验 → 草稿（`current_step`）→ 提交生成 `receipt_no`
- 状态机：按 [data-layer.md](backend/data-layer.md#状态机) 用状态转移表实现，全部 10 条转移
- 名额：条件更新 `已报名数 < max_slots`；满员置候补 `queue_no`；取消 / 递补自动处理
- 审核：通过 / 驳回（`review_remark`）、结果通知、`audit_log` 记录
- 签到：`checkin_time` 写入（扫码 / 线上）
- 通知：站内信直写、邮件标记 `send_status` 由宿主发送、订阅提醒由宿主定时任务触发

**M4（导出统计）**
- 名单导出：`wasm_export_chunk(offset, limit)` 分块，表头按 `form_field` 拼装
- 统计：按分组 / 字段 / 状态聚合，供看板

## 五、宿主实现计划（host/）

- HTTP 路由 + 会话鉴权（token 校验）、静态资源托管
- WebSocket：通知未读 / 审核结果 / 递补事件推送（断线重连 + 轮询兜底）
- SMTP：邮件发送队列 + 重试；定时任务：活动提醒、递补执行
- 部署：单实例进程（wasm 模块 + `sacc.db`），备份定时执行（SQLite backup API）

## 六、前端实现计划（frontend/）

**M5（基础与报名端）**
- Vite + React 19 + antd 5 工程；路由表 + 三种布局（[architecture.md](frontend/architecture.md)）
- 请求层：axios 拦截器 + TanStack Query；auth / 通知 store
- 报名端页面：工作台、活动大厅（分组树 + 卡片）、详情、分步报名表单（FormBuilder）、我的报名 / 凭证、通知中心、资料（常用信息 / 偏好）

**M6（管理端）**
- 活动管理：列表 / 编辑（FormDesigner 表单设计器）/ 复制 / 模板
- 报名运营：名单（RegistrationTable 动态列 + 批量）、审核队列（ReviewDrawer）、签到（CheckinScanner）、数据看板（DataBoard）

**M7（系统管理端与打磨）**
- 分组树管理、账号管理、角色授权（权限预览）、配置中心（ConfigEditor）、审计检索、数据治理
- 响应式全功能适配（[responsive-design.md](frontend/responsive-design.md)）、数据优化（[data-optimization.md](frontend/data-optimization.md)）、E2E 测试

## 七、验收标准（对照设计文档）

| 项 | 验收点 |
|---|---|
| 状态机 | 10 条状态转移全部可触发且落库正确 |
| 防超卖 | 并发报名不超过 `max_slots`；候补序号连续无重 |
| 权限 | 分组范围递归判定与权限预览一致；未授权返回 403 |
| 软删除 | 活动 / 表单 / 字段 / 分组软删后历史数据可导出 |
| 配置 | 新增配置键无需改表；变更进 `audit_log` |
| 多端 | 手机端功能与桌面一致（无删减） |

## 八、风险与依赖

| 风险 | 应对 |
|---|---|
| wasm 单线程写瓶颈 | 宿主排队 / 限流；必要时迁移 Rust 宿主或引入外部数据库 |
| 大数据导出内存 | 分块接口 + 前端流式下载 |
| SMTP / WebSocket | 宿主实现，wasm 不涉及网络 |
| SQLite 多实例 | 保持单实例部署；备份用 backup API |
| EAV 统计性能 | 聚合下推 wasm 导出层，前端不聚合 |
