# 灾难响应与恢复

> SACC 报名系统后端设计（[返回后端导航](index.md)）· 单实例架构（Node 宿主 + `backend.wasm` + SQLite 单文件）的备份、恢复、监控与安全事件响应。

## 一、风险清单与应对矩阵

| 场景 | 影响 | 检测 | 响应 |
|---|---|---|---|
| 数据库文件损坏 / 丢失 | 全部报名数据不可用 | 启动自检 `PRAGMA integrity_check` / `user_version` 异常 | 用最近备份恢复（见 [三](#三恢复流程)） |
| 磁盘写满（WAL 膨胀 / 日志） | 写失败、备份失败 | 数据目录容量监控 | 清理旧备份 / checkpoint 收缩 WAL / 扩容 |
| 服务崩溃 / 内存耗尽 DoS | 短时不可用 | 进程退出、`/api/health` 探活 | 宿主重启（systemd/PM2 守护）；body 上限已防内存 DoS（见 [server.js](../../host/src/http/server.js)） |
| 管理员误操作（误删活动/字段/批量改错） | 配置层数据错误 | `audit_log` 定位变更 | 用误操作前最近备份恢复该对象；软删可先行恢复 `is_deleted=0` |
| `JWT_SECRET` 丢失 | 重启后所有会话失效 | 启动日志告警（临时密钥） | 显式配置强随机密钥；见 [五-1](#51-jwt_secret-管理) |
| `JWT_SECRET` 泄露 | 攻击者可伪造任意用户会话 | 安全事件告警 | 立即轮换密钥（全部会话失效），见 [五-2](#52-jwt_secret-泄露响应) |
| 密码哈希库泄露 | 用户凭据风险 | 库文件异常访问告警 | 强制重置受影响账号密码；KDF 升级预案见 [五-3](#53-密码库泄露与-kdf-升级) |
| 部署故障（bad release / 迁移失败） | 服务不可用 | 启动失败日志、`yarn test` 门禁 | 回滚 = 恢复数据库备份 + 回退版本，见 [六](#六部署与回滚) |

## 二、备份策略

### 2.1 机制

SQLite 编入 wasm 模块，宿主无法直接调用 backup API → **新增 wasm op `db.backup`**（`sqlite3_backup_init` / `sqlite3_backup_step` 在线复制主库到目标文件），宿主定时任务调用：

| 项 | 决策 |
|---|---|
| 触发 | 宿主每日定时任务（`host/src/task/backup.js`）+ **每次迁移前自动备份** |
| 前置 | `PRAGMA wal_checkpoint(TRUNCATE)` 收缩 WAL，保证备份文件自洽 |
| 校验 | 备份完成后将目标文件 load 到临时 runtime，执行 `integrity_check` + `user_version` + 关键表计数冒烟 |
| 存储 | `data/backup/sacc-YYYYMMDD-HHMMSS.db`（在 WASI 预打开目录内，`runtime.relPath` 换算） |
| 保留 | 最近 **7 份** 全保留 + 每日 1 份保留 **30 天**；超限删除 |
| RPO | 默认每日；迁移前额外备份使 RPO 趋近 0（结构变更窗口） |
| RTO | 分钟级（停服 → 文件替换 → 启动校验） |

> 备份文件与 `sacc.db` 同机存储仅防误操作；防磁盘损坏需另做异地/对象存储同步（可选，部署时接入）。

### 2.2 恢复演练

- **定期演练**（至少每季度或发布前）：取最新备份 → load 到临时目录 → 运行 `yarn host:test` 冒烟 → 确认可读。
- 演练脚本：`scripts/restore-dryrun.sh`（只读验证，不改生产）。

## 三、恢复流程

```
1. 停服           systemctl stop sacc  （或 kill 宿主进程）
2. 定位备份       data/backup/ 最新可用份
3. 替换           cp backup.db data/sacc.db；删除 data/sacc.db-wal、-shm
4. 起服           systemctl start sacc（迁移框架发现 user_version 匹配即跳过）
5. 校验           启动自检通过 + /api/health + 抽查关键表计数（registration / activity / audit_log）
```

- **误操作恢复**：优先选误操作时间点之前的最近备份；先查 `audit_log` 确认时间点。
- **部分恢复**：软删对象（`is_deleted=1`）可直接置 0 恢复，无需整库回滚。

## 四、监控与自检

| 项 | 实现 | 状态 |
|---|---|---|
| 启动自检 | `PRAGMA integrity_check`（大库用 `quick_check`）+ `user_version` 与迁移目录一致 | ✅ 已实现（host 启动流程 [index.js](../../host/src/index.js)） |
| 运行健康 | `GET /api/health`、`GET /api/system/status`（wasm 版本 / user_version） | ✅ 已有 |
| 磁盘容量 | `data/` 目录阈值告警（宿主启动检查 + 定时任务） | ✅ 已实现（[backup.js](../../host/src/task/backup.js) `checkDiskSpace`） |
| 统一日志 | JSON 结构化日志（[logger.js](../../host/src/logger.js)） | ✅ 已有 |

## 五、安全事件响应

### 5.1 JWT_SECRET 管理

- 生产必须显式配置 `.env` 强随机密钥；未配置时宿主生成临时密钥并告警（重启会话失效，仅限开发）。
- **轮换流程**：生成新密钥 → 更新 `.env` → 重启 → 全部会话失效，用户重新登录（无状态 JWT 特性，无需服务端清理）。

### 5.2 JWT_SECRET 泄露响应

1. 立即轮换（见 5.1）——使所有已签发 token 失效。
2. 结合 `audit_log` 排查异常写操作。
3. 若怀疑特定账号被接管：按 [auth.md](auth.md) 重置其密码 / 禁用账号。

### 5.3 密码库泄露与 KDF 升级

- **已知技术债**：M1 哈希存储**不含 KDF 版本前缀**（[kdf.h](../../backend/src/crypto/kdf.h) 注释），无法在库中区分算法/迭代版本。
- 响应：库文件泄露时，强制重置受影响账号密码（或按批次引导改密）；WASM 内哈希 + 盐不落明文，盐 16B 随机，爆破成本高（PBKDF2 100k 迭代）。
- **升级预案**：后续 KDF 升级时，新哈希存储加版本前缀（如 `pbkdf2$100000$salt$hash`），登录时按前缀分派校验，旧哈希可渐进迁移——作为 M 系列里程碑的技术债登记，不阻塞 M2。

## 六、部署与回滚

- 发布物版本化：git tag + CI（`yarn test`）门禁；迁移文件追加式（`NNNN_*.sql`），不改历史迁移。
- **回滚流程**（迁移或发布失败）：恢复迁移前备份（迁移前自动备份已覆盖）→ 回退 `backend.wasm` / 宿主 / 前端构建产物到上一 tag → 起服校验。
- 禁止回滚时**降级执行新迁移**——数据库 schema 与旧代码不兼容时以备份恢复为准。

## 七、实施条目（纳入实现计划）

| # | 条目 | 归属 |
|---|---|---|
| 1 | wasm op `db.backup`（`sqlite3_backup` 在线备份 + checkpoint + 完整性校验） | backend（随 M2 一并实现）✅ 已实现 |
| 2 | host 定时备份任务 + 保留策略 + 迁移前自动备份 | host/src/task/ ✅ 已实现（`backup.js` + `migrate.js` 接入） |
| 3 | 启动自检（`integrity_check` / `user_version` 核对） | host 启动流程 ✅ 已实现 |
| 4 | `scripts/backup.sh` / `scripts/restore.sh` / `scripts/restore-dryrun.sh` | scripts/（待 M3+ 部署脚本阶段） |
| 5 | 数据目录容量告警 | host 定时任务 ✅ 已实现（`checkDiskSpace`） |
| 6 | KDF 版本前缀升级预案（登记技术债） | 文档（本文件） |
