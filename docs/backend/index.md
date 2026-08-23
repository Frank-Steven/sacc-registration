# 后端设计

> [返回总入口](../README.md)

后端使用 C++（编译为 WebAssembly）与 SQLite，运行于**服务端 WASM 运行时**，数据按**分层多表单**组织。

## 文档导航

| 文档 | 内容 |
|---|---|
| [wasm.md](wasm.md) | WebAssembly 技术方案（架构 / 编译 / ABI / 并发 / 部署） |
| [auth.md](auth.md) | 认证与账号体系（M1 实现：注册 / 登录 / 锁定 / 重置 / JWT） |
| [config.md](config.md) | 配置层与权限（M2 实现：活动 / 分组 / 表单 / 模板 / 配置 / 授权 / 审计） |
| [registration.md](registration.md) | 报名链路（M3 实现：草稿 / 提交 / 防超卖 / 候补递补 / 审核 / 签到 / 通知） |
| [export.md](export.md) | 导出统计（M4 实现：名单分块 / CSV / 单活动看板 / 趋势 / 跨活动统计） |
| [disaster-recovery.md](disaster-recovery.md) | 灾难响应与恢复（备份 / 恢复 / 监控 / 安全事件 / 回滚） |
| [config-layer.md](config-layer.md) | 配置层：活动 / 分组 / 表单 / 字段 / 配置预留 |
| [user-layer.md](user-layer.md) | 用户层：账号 / 角色 / 通知 / 订阅 / 偏好 |
| [data-layer.md](data-layer.md) | 数据层：报名 / 明细 + 状态机 |
| [principles.md](principles.md) | 设计要点 |
| [indexes.md](indexes.md) | 索引设计 |
| [flows.md](flows.md) | 典型流程 |

## 其他

- 系统总体设计：[../overview.md](../overview.md)（三层结构、跨层关联、表设计约定）
- 体验设计（按角色）：[../ux.md](../ux.md)
- 前端设计导航：[../frontend/index.md](../frontend/index.md)
