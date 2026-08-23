# M7 系统管理端与打磨设计

> SACC 报名系统 · 系统管理端前端设计（[返回前端导航](index.md)）· 后端契约见 [config.md](../backend/config.md)、[user-layer.md](../backend/user-layer.md)、[disaster-recovery.md](../backend/disaster-recovery.md)
>
> 对应里程碑：M7 系统管理 + 打磨（[development.md](../development.md) 一）· 体验依据 [ux.md](../ux.md)（超管章节）

基于 M6 已落地的管理端基座（AdminLayout / RequireAdmin / api/admin.js / ConfigEditor / GroupTreeSelect），实现**系统管理端**（分组 / 账号 / 角色授权 / 配置中心 / 审计 / 数据治理）与**打磨**。本版为 **UX × 视觉深度优化**：以超管角色旅程为主线组织信息架构与交互反馈，并以统一视觉系统约束全部页面的色彩 / 层级 / 状态表达。复用 M2 已有管理端 API 与权限模型，账号管理与数据治理需后端前置补齐（见「六、请求层扩展与后端前置补齐」）。

## 一、范围与定位

| 模块 | 页面 | 说明 | 可见角色 |
|---|---|---|---|
| 分组管理 | `/admin/groups` | 分组树 CRUD / 移动 / 软删标记 / 分组下活动 | 1 |
| 账号管理 | `/admin/accounts` | 用户搜索 / 状态筛选 / 禁用启用 / 重置密码 / 查看角色 | 1 |
| 角色授权 | `/admin/roles` | 按用户授角色 + 分组范围 + 权限预览 | 1 |
| 配置中心 | `/admin/system-config` | 系统级键值配置（`system_config.*`） | 1 |
| 审计检索 | `/admin/audit-logs` | 操作日志筛选 / 分页 / 详情（before/after） | 1 |
| 数据治理 | `/admin/governance` | 数据量统计 / 备份管理 / 软删清单 | 1 |

**非目标**：活动管理 / 报名运营（M6 已交付）；WebSocket 服务端实现（宿主规划见 [development.md](../development.md) 五，M7 前端仅接入推送 + 轮询兜底）。

**关键边界**（后端能力核对）：`group.*`、`role.list`、`user_role.*`、`system_config.*`、`audit_log.list` 路由已存在且仅超管可写/查（[config.md](../backend/config.md) 1.3）；**账号管理**无后端 ops → 新增 B1~B3；**数据治理**无统计/备份 HTTP 接口 → 新增 B4~B5。

## 二、UX 深度设计总纲

> 系统管理是**低频、高权、高影响**的域：使用者只有超管，每次操作都可能影响他人。UX 目标不是"做更多功能"，而是**让每一步都可解释、可撤回、不易错**。

### 2.1 设计原则

| 原则 | 含义 | 落地示例 |
|---|---|---|
| P1 任务优先 | 页面按"超管要完成的活"组织，不按数据堆砌 | 账号管理以"找人 → 处置"为主线，而非用户表格 |
| P2 防误触 | 影响他人的操作必须有确认 + 后果文案 | 禁用账号 Popconfirm 写"该用户将无法登录，已登录会话立即失效" |
| P3 可解释 | 每个限制/状态都要让超管看懂"为什么" | 删除分组 409 时展示具体占用（子分组 N / 活动 N）；审计详情 before/after |
| P4 可恢复 | 一切操作可逆或可补救 | 禁用可启用、重置可再重置、备份可下载；无物理删除 |
| P5 低摩擦 | 高频/连续操作 ≤2 步，焦点/键盘可达 | 搜索框默认聚焦；授权后"继续授权下一位" |

### 2.2 角色旅程（超管核心任务流）

**旅程 A「组建管理团队」**：账号管理搜人 → 角色授权（选角色 + 分组范围）→ 权限预览确认 → 告知对方登录
- 无跳出：授权抽屉内完成角色、范围、预览三步，确认即生效
- 预览联动：改角色/范围时预览实时更新；最终态与后端 1.3 矩阵一致
- 收尾提示：成功后提示"已生效，对方下次登录即拥有该权限"

**旅程 B「例行数据巡检」**：数据治理概览（一眼看增长/软删/库大小）→ 审计日志筛选近期变更 → 核对 → 一键备份
- 概览卡片可点击直达对应审计筛选（"今日审计操作 12 条" → 审计页带时间参数）
- 备份一键触发 + 进度反馈（进行中/完成/失败重试），完成后提供下载

**旅程 C「处理一起操作事故」**：审计检索（时间 + 操作人 + action）→ 展开 before/after diff → 定位对象 → 跳转对应页复核/修正 → 备份留证
- 审计行内"前往"按钮：按 target 类型跳转（activity:N → 活动编辑、group:N → 分组管理定位节点、user:N → 账号详情）
- diff 视图只高亮变更字段，未变更折叠

### 2.3 信息架构

- 系统管理 6 页归 3 组，菜单分组展示（antd Menu `itemGroup`）：

| 组 | 页面 | 心智 |
|---|---|---|
| 组织 | 分组 / 账号 / 角色授权 | "人"与"组织架构" |
| 系统 | 配置中心 / 审计日志 | "系统参数"与"留痕" |
| 数据 | 数据治理 | "资产与安全" |

- 导航深度 ≤2；授权页支持 `?uid=` 直达（账号页「授权」跳转预选用户）
- 每页一个主任务区（页面主按钮固定右上），次要操作收敛进行内/抽屉

### 2.4 操作反馈矩阵

| 影响级 | 判定 | 反馈形态 | 示例 |
|---|---|---|---|
| 低 | 仅影响对象本身、易恢复 | 直接执行 + message，无确认 | 重命名分组、保存配置、启用账号 |
| 中 | 影响他人、可恢复 | Popconfirm 二次确认 + 后果文案 | 禁用账号、撤授权（非超管）、移动分组 |
| 高 | 影响他人 / 系统、难恢复 | Modal 强确认 + 明确后果 + 不可逆标注 | 重置密码、撤销超管（后端 409 兜底）、删除分组 |
| 危险 | 触发即 409 | 前置 disabled + 悬停说明 + 后端 409 兜底 | 删除有子分组/绑定的分组 |

- 乐观更新：低影响操作先更新 UI，失败回滚（react-query `onMutate`/`onError`）
- 高影响操作一律等待后端确认，成功再收尾

### 2.5 状态设计（全页统一）

- **加载**：Skeleton（列表骨架 / 卡片骨架），不做全屏 spinner；首次进入系统管理显示骨架屏
- **空态**：插图 + 一句话 + 引导动作——分组空"还没有分组，先创建根分组"、审计空"筛选范围内无操作记录"、账号空"按关键字搜索"
- **错误**：系统管理路由内 403 → 权限说明卡（"仅超级管理员可访问系统管理"）+ 返回概览；409/422 文案直显并定位（表单字段红描 + 行内 Tag）
- **边界**：审计/账号大数据量分页 + 虚拟滚动；重置密码结果**一次性展示后自动清空**（10s 后隐藏，防滞留泄漏）

### 2.6 微交互

- 数据治理统计数字变化 → 计数动画（`@ant-design/charts` 或轻量自绘）
- 权限预览切换角色/范围 → 能力矩阵淡入切换
- 分组树移动成功 → 节点高亮 + message；保存类按钮成功态"已保存 ✓"
- 备份进度：按钮转 loading → 完成 message + 列表尾部插入新行并高亮

### 2.7 可访问性与键盘

- 全部操作键盘可达：表格行操作 Enter/Space 触发；树节点方向键导航 + 行内菜单
- 弹窗/抽屉：打开聚焦首元素，关闭还原焦点（antd 默认）
- 对比度 AA；表单 label 显式关联；错误 `aria-describedby`；角色/状态 Tag 附带文本说明（不只靠颜色）
- 审计 diff 提供纯文本视图（非仅高亮色块）

### 2.8 移动端 UX（管理端专项）

- AdminLayout `xs/sm`：汉堡 → 抽屉全量菜单（含系统管理 3 组）
- 授权抽屉全屏 + 底部固定「确认授权」操作条；树收纳为抽屉面板
- 数据治理卡片纵向堆叠；统计数字大字号展示
- 触控目标 ≥44px；表格横向滚动而非缩放；表单单列
- 连续任务优化：账号处置列表卡片化，滑动即见操作按钮

### 2.9 一致性

- 确认弹窗 / Drawer / 表格操作列 / 状态 Tag 沿用 M5/M6 既有模式（Popconfirm、Action 列、RegistrationStatusTag 风格）
- i18n 双语延续（`admin.sys.*` 命名空间）；深浅主题变量复用
- 空态 / 骨架 / 错误卡样式与报名端一致，不引入第二套视觉

## 三、视觉统一性设计

> 管理端视觉的使命：**让状态一眼可读、层级一眼可辨、操作位置始终可预期**。全部页面共用一套视觉语言，禁止页面自造样式。

### 3.1 设计 Token（统一取值来源）

基础 token 沿用 [main.jsx](../../frontend/src/main.jsx) `ConfigProvider`（`colorPrimary #1677ff`、`borderRadius 6`、dark algorithm 随偏好切换）。系统管理在此之上扩展**语义 token 文件**（如 `theme/statusColors.js`），唯一出口：

| Token | 值（antd 语义色） | 用途 |
|---|---|---|
| `colorPrimary` | `#1677ff` | 主操作、选中态、强调数字 |
| `colorSuccess` | `#00b42a` | 通过 / 正常 / 完成 |
| `colorWarning` | `#ff7d00` | 待处理 / 预警 / 已截止 |
| `colorError` | `#f53f3f` | 驳回 / 禁用 / 失败 / 危险 |
| `colorInfo` / `colorGeekblue` | `#1677ff` / `#2f54eb` | 进行中 / 审计分域 |
| `colorText` / `colorTextSecondary` | antd 色板 | 文本层级（不用 #999 等裸值） |
| `borderRadius` | `6`（统一） | 卡片 / 表格 / 弹窗 |

**红线（强制）**：任何页面不出现硬编码色值 / 圆角 / 阴影，一律走 `theme.token` 或 antd 语义组件（`colorSuccess` 等）；深浅主题由 token 自动切换，不做手工配色分支。

### 3.2 页面骨架统一（六页同一结构）

```
PageHeader（标题 20/600 + 副标题描述 + 右上主操作按钮）
 └─ Card（筛选栏：可选，顶部内联 Form）
     └─ 内容区（表格 / 树+列表 / 卡片组）
         └─ 抽屉 / Modal（480px，header 16/600 + 说明副文字）
```

- PageHeader：左侧回退（`ArrowLeftOutlined`，二级页），右侧唯一 `type="primary"` 主操作；页标题 L2（3.7）
- 间距：4px 基准栅格（8/16/24，全表见 3.8）；卡片 bodyPadding 16/20；筛选栏与内容间距 16
- 弹窗/抽屉统一宽度 480、圆角 6、footer 按钮右对齐（次 → 主，间距 8）

### 3.3 组件视觉规范

| 组件 | 统一规范 |
|---|---|
| 按钮 | primary（每页唯一主操作）/ default / text；危险操作用 danger（红），均带 `@ant-design/icons` 图标 |
| Tag | 圆角 2、字号 12、**衬底浅色非实心**（antd `color={x}` 默认态）；附文字说明（2.7） |
| 表格 | 文本列左对齐、数字列右对齐、操作列右对齐固定宽；行 hover 高亮；空态用统一 Empty 组件 |
| 表单 | 管理端统一 `layout="vertical"`，label 12 字重 500，必填星标；错误红描 + `aria-describedby` |
| 抽屉 / Modal | 宽度 480、标题 16/600 + 副标题 12/secondary 说明操作后果 |
| 空态 / 骨架 | antd `Empty` + 引导按钮；`Skeleton` 卡片（非全屏 spinner） |
| 图标 | 全部 `@ant-design/icons` 线性风格；**禁用 emoji / 自定义图形**；功能图标语义一致（新增 `+`、删除 `DeleteOutlined`、编辑 `EditOutlined`、禁用 `StopOutlined`） |

### 3.4 状态色映射（全站收敛，一处定义）

| 域 | 值 → 语义色 | 现状 |
|---|---|---|
| 活动状态 0/1/2/3 | default / success / warning / error | 沿用 M6 `ActivityStatusTag` |
| 报名状态 0~5 | 既定映射 | 沿用 M5 `RegistrationStatusTag` |
| **角色** role 1/2/3 | error（超管）/ processing（活动管理员）/ default（审核员） | M7 新增，统一 `RoleTag` |
| **账号状态** 正常/禁用 | success / error | M7 新增 |
| **审计 action 域** | activity=processing / group=geekblue / form=purple / user_role=orange / system=default | M7 新增，前缀 Tag 分域 |
| **备份状态** 进行中/完成/失败 | processing / success / error | M7 新增 |

> 原则：**同一状态全站同色**（如"禁用"永远 error 红），不因页面而异；新状态色一律并入 3.1 token 文件，禁止页面另造。

### 3.5 微视觉

- 数字强调：数据治理统计数字 `colorPrimary + fontWeight 600 + 大字号（28）`，弱化单位（12/secondary）
- diff 视图：变更字段 `warning` 浅底 + `DeleteOutlined`（before 划线删除）→ `CheckOutlined`（after 高亮），统一配色与图标
- 权限预览矩阵：✅/❌ 用 `CheckOutlined` / `CloseOutlined` + success/error 语义色（不用 emoji）
- 密钥字段：`Input.Password` 掩码 + `EyeOutlined` 切换，缺失警示统一 `Alert type="warning"`
- 备份行：文件类型图标（`FileZipOutlined`）+ 大小/时间 secondary 文本

### 3.6 深浅主题

- 卡片 / 表格 / 抽屉背景走 token（`colorBgContainer`），暗色自动适配；文本层级用 `colorText / colorTextSecondary`
- 语义 Tag 深浅主题下对比度 AA（2.7）；侧栏保持 `#001529`（现状，不随主题变）

### 3.7 字体与排版

**字族**（全局统一，页面不另定义）：antd 默认栈 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`（中英文自动回退）；数字 / 时间 / 凭证号等数据列启用 `font-variant-numeric: tabular-nums` 等宽对齐。
**禁止**：斜体中文、页面内自定义 `font-family`、用加粗替代字号层级。

**字号 · 字重阶梯**（5 级，全部走 `theme.token.fontSize`）：

| 级 | 字号/字重 | 用途 |
|---|---|---|
| L1 | 28 / 700 | 强调数字（数据治理统计主数字） |
| L2 | 20 / 600 | 页标题（PageHeader） |
| L3 | 16 / 600 | 卡片标题 / 抽屉标题 |
| L4 | 14 / 400 | 正文 / 表格数据（默认） |
| L5 | 12 / 400 | 辅助说明 / Tag / 单位（secondary） |

- 表头 14/600（`colorText`）；表单 label 14/500（管理端 vertical 布局）
- 行高：正文 1.5715（antd 默认）、标题 1.5；表格行高统一 48

**中文排版规则**：
- 中文与数字/英文之间不加空格（系统文案统一措辞）
- 文本截断统一 `textOverflow: ellipsis` + Tooltip 完整值（管理端表格长字段）
- 日期 / 大小 / 百分比等格式一律走 i18n 模板或统一 format 工具，禁止页面散落硬编码格式

### 3.8 间距系统

**栅格**：4px 基准，五档间距 token `8 / 12 / 16 / 24 / 32`；页面布局用 antd 24 列栅格（`Row gutter={16}`）。

| 场景 | 间距 |
|---|---|
| 图标 ↔ 文字（元素内） | 8 |
| 相邻控件 / 按钮组 | 8 |
| 表单 item 间距（vertical） | 24 |
| 卡片 padding | 16 / 20 |
| 卡片之间 | 16（同组）/ 24（异组） |
| 筛选栏 ↔ 内容区 | 16 |
| PageHeader ↔ 内容 | 16 |
| 页面级大区 | 24 / 32 |

**层次原则（亲密性）**：相关元素 8/16、独立区块 24、页面分区 32——间距承担层次表达，**禁止用颜色区分替代留白**。
**对齐**：管理端统一左对齐排版；操作列右对齐固定、数字列右对齐、文本列左对齐；卡片内容左边缘对齐（不居中）。

**现状优化点**（对比 M6 落地时统一）：
- 按钮组统一 `gap 8`；抽屉 footer 按钮右对齐且间距 8
- 表格行高 48 统一（`padding` 竖 12）；表头排序图标与文字间距 4
- 树节点行高 32、子级缩进 24/级；卡片内 section 标题与内容间距 12

## 四、路由与权限

### 4.1 路由表

全部挂载在 `/admin`（`AdminLayout`），页级懒加载（沿用 `suspend` 模式）：

| 路径 | 页面 | 守卫 |
|---|---|---|
| `/admin/groups` | 分组管理 GroupManager | role 1 |
| `/admin/accounts` | 账号管理 AccountManager | role 1 |
| `/admin/roles` | 角色授权 RoleManager | role 1 |
| `/admin/system-config` | 配置中心 SystemConfig | role 1 |
| `/admin/audit-logs` | 审计检索 AuditLogs | role 1 |
| `/admin/governance` | 数据治理 Governance | role 1 |
| `/admin/*` | 兜底 → 404（既有） | — |

### 4.2 守卫升级：RequireSuperAdmin

- 在既有 `RequireAdmin`（role 1/2/3 放行）基础上新增 **`RequireSuperAdmin`**：`useQuery(['my-roles', uid])` 中 `role_id === 1` 才放行；否则显示 2.5 权限说明卡并重定向 `/403`
- 实现：`RequireSuperAdmin` 包裹系统管理子路由；菜单显隐与路由守卫共用 `my-roles` 缓存
- 后端 403 兜底：系统管理 ops 均校验仅超管，越权错误文案直显

### 4.3 权限矩阵（系统管理域）

| 操作 | role 1 超管 | role 2 活动管理员 | role 3 审核员 |
|---|---|---|---|
| 分组 CRUD / 移动 / 删除 | ✅ | ❌ 隐藏（后端 403） | ❌ |
| 账号禁用 / 启用 / 重置 | ✅ | ❌ | ❌ |
| 角色授权（授 / 撤 / 分组范围） | ✅ | ❌ | ❌ |
| 系统配置读写 | ✅ | ❌ | ❌ |
| 审计检索 | ✅ | ❌ | ❌ |
| 数据治理（备份 / 统计） | ✅ | ❌ | ❌ |

## 五、布局扩展（AdminLayout）

- 菜单新增「系统管理」itemGroup（仅 `role_id === 1` 渲染，图标走 3.3 规范）：

| 组 / 菜单 | 路径 | 图标 |
|---|---|---|
| 组织 · 分组管理 | `/admin/groups` | ApartmentOutlined |
| 组织 · 账号管理 | `/admin/accounts` | TeamOutlined |
| 组织 · 角色授权 | `/admin/roles` | SafetyCertificateOutlined |
| 系统 · 配置中心 | `/admin/system-config` | SettingOutlined |
| 系统 · 审计日志 | `/admin/audit-logs` | FileSearchOutlined |
| 数据 · 数据治理 | `/admin/governance` | DatabaseOutlined |

- 活动上下文（报名运营子菜单）逻辑不变；系统管理静态展示，与活动选择无耦合

## 六、请求层扩展与后端前置补齐

### 6.1 api/admin.js 新增 system 域

| 域 | 函数 | 端点（op） |
|---|---|---|
| groups | tree / create / update / remove | `group.tree`、`group.create`、`group.update`、`group.delete`（复用 adminGroupApi，增补 create/update/remove） |
| accounts | adminList / setStatus / resetPassword / roles | `user.admin_list`（B1）、`account.set_status`（B2）、`account.admin_reset`（B3）、`user_role.list`（既有） |
| roles | roleList / grant / revoke / userRoles | `role.list`、`user_role.grant`、`user_role.revoke`、`user_role.list`（既有） |
| systemConfig | list / set | `system_config.list`、`system_config.set` |
| audit | list | `audit_log.list` |
| governance | dbStats / backups / createBackup / downloadBackup | `db.stats`（B4）、host 备份路由（B5） |

Query 键：`['admin-groups']`、`['admin-accounts', filters]`、`['admin-user-roles', uid]`、`['admin-system-config']`、`['admin-audit', filters]`、`['admin-db-stats']`、`['admin-backups']`；写操作成功后 invalidate 对应键。

### 6.2 后端前置补齐（B1~B5，契约先行）

| 编号 | op / 路由 | 契约 | 权限 |
|---|---|---|---|
| B1 | `user.admin_list` | `GET /api/admin/users`；参数 `page` `page_size` `keyword`（username/name/student_id/phone 模糊）`status`；返回 `{ items: [{ uid, username, name, student_id, college, phone, email, status, roles: [{role_id, name, group_id, group_name}], created_at, last_login_at }], total }` | 仅超管 |
| B2 | `account.set_status` | `POST /api/admin/users/:uid/status`；body `{ status: 0|1 }`；禁用自己 → 409「不能禁用当前登录账号」 | 仅超管 |
| B3 | `account.admin_reset` | `POST /api/admin/users/:uid/reset-password`；返回 `{ password }`（随机 12 位，一次性展示）；同时清除 `login_fail_count` / `lock_until` | 仅超管 |
| B4 | `db.stats` | `GET /api/admin/db/stats`；返回 `{ table_counts: { activity, registration, registration_data, "user", notification, audit_log, ... }, deleted_counts: { activity, "group", form, form_field }, db_size }` | 仅超管 |
| B5 | host 备份路由 | `GET /api/admin/backups` 列出备份目录文件（名称/大小/时间）；`POST /api/admin/backups` 触发 `db.backup` + 宿主落盘；`GET /api/admin/backups/:file` 下载 | 仅超管 |

> 既有可复用：`group.*`（分组管理）、`role.list` + `user_role.*`（角色授权）、`system_config.*`（配置中心）、`audit_log.list`（审计）、`db.backup` + `task/backup.js`（备份能力）均已存在，见 [config.md](../backend/config.md) 2.2 与 [disaster-recovery.md](../backend/disaster-recovery.md)。

## 七、分组管理 GroupManager `/admin/groups`

**UX 主线**：先看清组织树 → 定点操作（新建/改名/移动/删除）→ 关联活动一目了然。

- **数据**：`GET /api/admin/groups/tree`（`group.tree` 完整树，含软删标记）
- **交互与反馈**：
  - 树节点操作：新增子分组（name + sort_order）、重命名、**移动**（`group.update.parent_id`；目标父节点选择器排除自身子树，前端即置灰，后端 409 兜底）、删除（有子分组/活动绑定 409 → **P3 可解释**：错误文案带具体占用数，并提供「查看分组活动」跳转）
  - 软删分组 Tag「已删除」置灰，不提供恢复（软删为终态）；悬停说明"历史数据保留，报名端不可见"
  - 选中节点 → 右侧面板该分组下活动列表（`GET /api/admin/activities?group_id=x`），行操作跳活动编辑
  - 低影响操作（改名/排序）乐观更新；删除走 2.4 危险级确认
- **视觉要点**：左树右列表双栏布局；节点操作图标统一（新增 `+` / `EditOutlined` / 删除 `DeleteOutlined`）；软删节点整体降透明度（`opacity .5`）走 token 中性色
- **空态**：无分组 → "还没有分组，先创建根分组"引导按钮
- **移动端**：树收纳抽屉，右侧活动列表单列

## 八、账号管理 AccountManager `/admin/accounts`

**UX 主线**：找人（搜索/筛选）→ 看一眼（角色/状态）→ 处置（禁用/重置/授权）。

- **数据**：`GET /api/admin/users`（B1），筛选：关键字（用户名/姓名/学号/手机）、状态（全部/正常/禁用）；分页
- **交互与反馈**：
  - 搜索框默认聚焦；输入防抖 300ms 触发检索
  - 行操作：
    - 查看角色：抽屉展示 `GET /api/admin/users/:uid/roles`（角色名 + 分组范围 + 生效时间）
    - 禁用 / 启用：Popconfirm（**后果文案**："禁用后该用户将无法登录，已登录会话立即失效"；自己所在行不渲染禁用按钮，P2 防误触）
    - 重置密码：Modal 强确认 → 返回随机密码**一次性展示 + 10s 自动清空**（2.5 边界）→ "已清除登录锁定"提示
    - 授权：跳转 `/admin/roles?uid=xxx`（旅程 A 无跳出衔接）
  - 表格列：用户名 / 姓名 / 学号 / 手机 / 邮箱 / 状态 Tag / 角色 Tags / 最近登录 / 注册时间 / 操作
  - 乐观更新：启用/禁用即时切换 Tag，失败回滚
- **视觉要点**：状态列用 3.4 `RoleTag`/账号状态色（正常 success / 禁用 error）；操作列图标按钮 + 文字 Tooltip；禁用行整行降透明度；自己所在行 Tag「我」标出
- **空态**：无匹配用户 → "未找到匹配的用户，换个关键字试试"
- **边界**：禁用自己 409 文案直显；重置密码审计记录（`account.admin_reset`）

## 九、角色授权 RoleManager `/admin/roles`

**UX 主线**（旅程 A）：选人 → 看现有授权 → 添加（角色 + 范围）→ 预览确认。

- **用户选择**：顶部搜索（复用 B1），支持 `?uid=` 直达预选；选中后进入授权区
- **授权抽屉**：
  - 当前角色列表：`GET /api/admin/users/:uid/roles`，行「移除」（Popconfirm；撤销最后一个超管 → 后端 409 "无法撤销最后一个超级管理员"直显）
  - 添加授权：角色下拉（`role.list`）+ **分组范围**（GroupTreeSelect 单选；"全范围"选项置顶 + 说明"该角色可管理所有分组"）+ 确认 → `POST /api/admin/roles/:roleId/users`
- **权限预览**（2.2 旅程 A 实时联动，本地计算，决策 D4）：
  - 合并该用户全部 `user_role` 判定：任一 role 1 → 「超级管理员 · 全范围」
  - 否则按 role 2/3 + 分组范围聚合 → 「活动管理员/审核员 · 分组 {名及子分组}」（group_id NULL 显示「全范围」）
  - 能力矩阵静态映射展示（活动 CRUD/表单/名单/审核/签到/系统管理），切换即时淡入更新
  - 预览与后端 1.3 矩阵一致性由验收保证（十七、验收）
- **视觉要点**：角色用 3.4 `RoleTag` 统一三色；预览矩阵单元格用 `CheckOutlined`/`CloseOutlined` + success/error（3.5）；分组范围文本 secondary；抽屉副标题说明"以下权限实时反映该用户当前全部授权"
- **收尾**：授权成功 message "已生效，对方下次登录即拥有该权限"（旅程 A）；支持"继续授权下一位"（不关闭抽屉直接换人，P5 低摩擦）

## 十、配置中心 SystemConfig `/admin/system-config`

**UX 主线**：看全局参数 → 就地改 → 保存即生效（并留痕）。

- **数据**：`GET /api/admin/system/config`（`system_config.list`）
- **交互与反馈**：
  - 复用 ConfigEditor 参数化 **system 模式**（`activityId` 为空 → `system_config.list/set`），类型化渲染：0 布尔 Switch / 1 数字 InputNumber / 2 文本 Input / 3 JSON 文本域
  - **键白名单**（config.md 3.5）：`site_name`（2）、`max_upload_size`（1）、`checkin_secret`（2，**密码掩码**显示；保存后不回显明文；缺失时警示条"未配置，动态码签到不可用"——M6 踩坑教训）
  - 低影响操作直接保存（2.4）：批量 `PUT /api/admin/system/config` → message + invalidate；变更自动进 `audit_log`
  - 保存按钮成功态"已保存 ✓"（2.6）
- **视觉要点**：配置项分组卡片（按键前缀：site / upload / checkin）；密钥 `Input.Password` 掩码（3.5）；缺失警示统一 `Alert type="warning"`
- **移动端**：单列编辑，密钥字段掩码 + 复制按钮（便于粘贴到部署配置）

## 十一、审计检索 AuditLogs `/admin/audit-logs`

**UX 主线**（旅程 B/C）：圈定范围（时间+人+动作）→ 结果里找目标 → 看 diff → 跳转处置。

- **数据**：`GET /api/admin/audit-logs`（`audit_log.list`，仅超管）
- **筛选**（强制服务端过滤）：操作人（用户名 → `operator_uid`）、action 下拉（枚举：activity.* / group.* / activity_group.* / form.* / form_field.* / form_template.* / activity_config.set / system_config.set / user_role.* / account.admin_reset）、时间范围（RangePicker → start_time/end_time）
- **交互与反馈**：
  - 表格：时间 / 操作人 / action Tag / 对象 target / 操作项
  - 详情：展开行 diff 视图（2.2 旅程 C）——**只高亮变更字段**，update 显示 before→after；提供纯文本视图（2.7）
  - 行内「前往」按钮：按 target 前缀跳转（activity:N → 活动编辑；group:N → 分组管理定位节点；user:N → 账号详情；`system_config.set` → 配置中心），跳转后 toast "已定位到目标对象"
  - 从数据治理概览进入时预填时间范围（旅程 B）
- **视觉要点**：action 前缀 Tag 用 3.4 分域色；diff 变更字段 warning 浅底 + 划线/高亮（3.5）；时间列等宽字体（`font-variant-numeric: tabular-nums`）
- **空态**：筛选范围内无记录 → "筛选范围内无操作记录，放宽条件试试"
- **边界**：大结果分页 + 虚拟滚动；action 下拉按操作域分组

## 十二、数据治理 Governance `/admin/governance`

**UX 主线**（旅程 B）：先看全局（数字）→ 点卡片下钻 → 需要时备份。

| 卡片 | 数据 | 交互与反馈 |
|---|---|---|
| 数据量概览 | `db.stats`（B4） | 核心表行数 + 软删计数 + 库大小；数字**计数动画**；软删项提示"软删数据保留用于历史导出"；卡片点击下钻审计/对应页（旅程 B） |
| 备份管理 | `GET /api/admin/backups`（B5） | 文件列表（名称/大小/时间/下载）；「立即备份」→ loading → 新行插入并高亮 + message；失败可重试；保留策略说明（沿用 `task/backup.js` 轮转） |
| 软删清单 | `db.stats` deleted_counts | 活动/分组/表单/字段软删数量展示；**不提供物理清理**（决策 D6），点击跳对应管理页 |

- **视觉要点**：统计数字 `colorPrimary 600 / 28px` + secondary 单位（3.5）；备份行 `FileZipOutlined` + 状态 Tag（processing/success/error，3.4）；卡片组等宽栅格（`Row gutter 16`）
- **空态**：无备份记录 → "尚无备份，点击立即备份创建第一份"
- **边界**：备份大文件下载用流式；进行中按钮防重复触发（loading 禁用）

## 十三、响应式打磨

基于 [responsive-design.md](responsive-design.md) 对全站逐页适配（无功能删减）：

1. **AdminLayout**：`xs/sm` 下 Sider 收起 → 顶栏汉堡 + 抽屉全量菜单（含系统管理 3 组，2.8）
2. **系统管理页**：表格 → 卡片列表/横向滚动；授权/审核抽屉全屏 + 底部操作条；GroupTreeSelect 树收纳抽屉
3. **既有页面抽查**：活动编辑 Tabs 单列堆叠、看板图表纵向滚动、签到大屏竖屏适配
4. **移动细节**：触控目标 ≥44px、`env(safe-area-inset-*)`、FormDesigner 长按排序（`dnd-kit` 多输入）

验收口径：手机端功能与桌面完全一致（development.md 七「多端」）。

## 十四、数据优化

基于 [data-optimization.md](data-optimization.md)：

1. **缓存分层**：分组树 / 角色 / 系统配置 / 表单字段 = 只读长 `staleTime`；名单 / 审计 = 不缓存、服务端分页筛选
2. **大数据量**：名单表格虚拟滚动（antd Table `virtual`）+ 表头冻结；审计强制服务端筛选
3. **实时通知**：宿主 WebSocket 推送（未读 / 审核结果 / 递补）→ 更新 zustand 角标 + 当前页 invalidate；断线重连 + **轮询兜底（保留 15s 轮询）**，决策 D8
4. **构建**：系统管理页独立 chunk（懒加载）；图表 / 二维码按需引入不进主包

## 十五、E2E 测试（Playwright）

| 项 | 方案 |
|---|---|
| 框架 | Playwright（@playwright/test），独立于 `yarn test`（脚本 `yarn e2e`） |
| 配置 | `frontend/e2e/playwright.config.js`：webServer 启动宿主 + 前端，baseURL 指向 dev server |
| 用例 | ① 注册登录 → 报名提交 → 审核 → 签到 全链路 ② 管理端：建活动 → 设计表单 → 发布 → 名单导出 ③ 权限：普通用户访问 `/admin` 与 `/admin/accounts` 被拦截 ④ 系统管理：分组 CRUD、授权 + 权限预览、配置中心保存 ⑤ 实时：详情页名额自动刷新（15s 轮询断言） |
| 数据隔离 | 用例自建唯一用户名（时间戳后缀）+ 独立活动；不依赖种子数据；清理走接口或忽略 |
| CI | GitHub Actions 增 job：playwright install + `yarn e2e`（与 `yarn test` 并行） |

## 十六、实现计划

**前端**
1. `RequireSuperAdmin` 守卫 + AdminLayout 系统管理 itemGroup 菜单（复用 `['my-roles']`）
2. 视觉 token 文件 `theme/statusColors.js`（3.1）+ `RoleTag` 组件（3.4）
3. `api/admin.js` system 域（groups 增补 + accounts + roles + systemConfig + audit + governance）
4. 系统管理六页（按 UX 主线 + 3.2 骨架实现）：GroupManager → AccountManager → RoleManager（权限预览）→ SystemConfig（ConfigEditor system 模式）→ AuditLogs（diff 视图）→ Governance（备份管理）
5. UX/视觉细节落地：反馈矩阵（2.4）、状态设计（2.5）、微交互（2.6/3.5）、可访问性（2.7）
6. 响应式：AdminLayout 移动端抽屉 + 六页断点适配 + 既有页面抽查
7. 数据优化：名单虚拟滚动、审计服务端筛选、WS 通知接入（宿主就绪后）+ 轮询兜底
8. E2E：Playwright 工程 + 五组用例 + CI job

**后端前置补齐（契约先行，随 M7 同批）**
- B1 `user.admin_list`、B2 `account.set_status`、B3 `account.admin_reset`（均审计 + 仅超管）
- B4 `db.stats`（wasm op）
- B5 宿主备份路由（`GET/POST /api/admin/backups`、下载），复用 `task/backup.js`

**测试**：`yarn test` 全量（新增 ops 补 native 单测 + smoke 用例）+ `yarn e2e`（Playwright）

## 十七、验收标准

| 项 | 验收点 |
|---|---|
| 权限 | 普通用户访问 `/admin` → /403；活动管理员访问系统管理路由 → 权限说明卡 + 重定向；后端 403 兜底 |
| 反馈 | 分级确认正确（低影响直执、中 Popconfirm、高 Modal）；后果文案清晰；乐观更新失败回滚 |
| 分组 | 树 CRUD / 移动（前端置灰 + 后端 409）/ 删除限制（409 带占用说明）；软删标记可见 |
| 账号 | 搜索防抖 / 筛选 / 禁用启用 / 重置密码（一次性随机密码 10s 清空）；不能禁用自己 |
| 角色 | 授权 + 分组范围 + 移除可用；防锁死（撤销最后超管 409）；**权限预览与能力矩阵一致** |
| 配置 | system_config 类型化保存生效（checkin_secret 掩码 + 缺失警示）；变更进审计 |
| 审计 | 筛选（操作人/action/时间）+ 分页 + diff 视图（变更字段高亮）+「前往」跳转 |
| 数据治理 | 统计正确（计数动画）；立即备份生成文件可下载；软删只展示不清理 |
| 多端 | 系统管理页手机端功能与桌面一致（全功能不删减） |
| 可访问性 | 键盘可达、焦点管理、对比度 AA、Tag 附文本 |
| **视觉统一** | 无硬编码色值/圆角（全部走 token）；状态色映射全站一致（3.4）；六页骨架/操作位置统一（3.2）；图标统一 `@ant-design/icons`（3.3）；**字体走字号阶梯、无页面自定义字族（3.7）；间距走 4px 栅格（3.8）**；深浅主题正确切换 |
| E2E | 五组用例在 CI 全绿 |

## 十八、决策记录

| 项 | 决策 |
|---|---|
| D1 | 系统管理并入 `/admin`（AdminLayout），菜单「系统管理」itemGroup 三组展示 |
| D2 | 守卫：`RequireSuperAdmin`（role 1）包裹系统管理子路由；后端 403 兜底 |
| D3 | 账号管理无现成 API → 后端补齐 B1~B3（契约先行，同 M5 模式） |
| D4 | 权限预览 = 本地静态能力矩阵 + 分组范围合并展示，不新增后端「预览」op |
| D5 | 配置中心复用 ConfigEditor（system 模式参数化），不重复实现类型化渲染 |
| D6 | 数据治理仅统计 + 备份，不提供软删物理清理（数据安全优先，历史导出依赖软删） |
| D7 | E2E 用 Playwright，关键路径冒烟，独立 `yarn e2e` 并接入 CI |
| D8 | 实时通知 WS 接入 + 保留 15s 轮询兜底（断线不丢通知） |
| D9 | 反馈分级：低/中/高/危险四级（message / Popconfirm / Modal / 前置 disabled + 409），全站统一 |
| D10 | 高影响操作结果一次性展示（重置密码 10s 自动清空），防敏感信息滞留 |
| D11 | 视觉统一：语义 token 单一出口 + 状态色映射全站收敛（3.4）+ 禁止页面硬编码样式 |
| D12 | 字体统一走 5 级字号/字重阶梯（3.7，禁止页面自定义字族）；间距统一走 4px 栅格与层次原则（3.8） |
