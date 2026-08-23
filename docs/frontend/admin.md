# M6 管理端设计

> SACC 报名系统 · 管理端前端设计（[返回前端导航](index.md)）· 后端契约见 [config.md](../backend/config.md)、[registration.md](../backend/registration.md)、[export.md](../backend/export.md)

基于 M5 已落地的工程基座（Vite + React 19 + antd 5 + React Router 7 + TanStack Query + Zustand + i18n + 深浅主题），实现管理端（活动管理 + 报名运营），消费 M2/M3/M4 已有管理端 API，**无新增后端 ops**（仅宿主路由确认，见「八、后端现状核对」）。

## 一、范围与定位

| 模块 | 页面 | 说明 |
|---|---|---|
| 概览 | `/admin` | 跨活动数据看板（`activity.stats`） |
| 活动管理 | `/admin/activities`、`/admin/activities/:id` | 列表 / 编辑（基本信息 + 分组绑定 + 活动配置 + 状态流转）/ 复制 / 模板 |
| 表单设计 | 活动编辑内嵌 FormDesigner | 表单组 + 字段编辑 + 校验 + 模板套用 |
| 报名运营 | `/admin/activities/:id/registrations`、`/review`、`/checkin`、`/stats` | 名单 / 审核队列 / 签到 / 单活动看板 |
| 模板 | `/admin/templates` | 模板 CRUD（套用在活动编辑内） |

**非目标（M7）**：分组树管理、账号 / 角色授权、系统配置中心、审计检索、数据治理；移动端响应式打磨。

**关键边界**（后端能力核对，契约来源见第八节）：
- 管理端**无**批量操作、无报名修改/取消、无通知管理/订阅管理接口 → M6 不做这些功能
- 审核队列 / 已签名单 = 名单接口 + `status` 过滤（`status=1` 待审、`status=2` 已通过）
- 「复制活动」无独立 API → 用「保存为模板 + 新建 + 套用」组合实现（决策 D2）

## 二、路由与权限

### 2.1 路由表

全部挂载在 `/admin`（`AdminLayout`），页级懒加载（沿用 `suspend` 模式）：

| 路径 | 页面 | 可见角色 |
|---|---|---|
| `/admin` | 概览看板 Dashboard | 1/2/3 |
| `/admin/activities` | 活动列表 | 1/2（3 只读进入活动编辑） |
| `/admin/activities/:id` | 活动编辑（基本信息 + 分组 + 配置 + 状态流转 + 表单设计器） | 1/2 可写，3 只读 |
| `/admin/activities/:id/registrations` | 名单 | 1/2/3 |
| `/admin/activities/:id/review` | 审核队列 | 1/2/3（3 为审核员） |
| `/admin/activities/:id/checkin` | 签到 | 1/2/3 |
| `/admin/activities/:id/stats` | 单活动看板 | 1/2/3 |
| `/admin/templates` | 模板管理 | 1/2 |
| `/admin/*` | 兜底 → 404 | — |

### 2.2 RequireAdmin 守卫（新增）

- 已登录 + 至少一个管理角色（role 1/2/3）才放行；否则 `/403`
- 当前用户角色：`GET /api/admin/users/:uid/roles`（op `user_role.list`，路由已存在，`target_uid` 取路径参数），进入 AdminLayout 时 `useQuery(['my-roles', uid])` 拉取，缓存到会话
- `auth.me` 返回不含角色，须以上述接口为准（决策 D4）

### 2.3 角色门控矩阵（前端按钮显隐，后端 403 兜底）

| 操作 | role 1 超管 | role 2 活动管理员 | role 3 审核员 |
|---|---|---|---|
| 活动 CRUD / 状态流转 / 删除 | ✅ | ✅（授权分组内） | 隐藏 |
| 表单 / 字段 / 模板 / 活动配置编辑 | ✅ | ✅ | 隐藏 |
| 名单查看 / 导出（CSV / 分块） | ✅ | ✅ | ✅ 查看；导出隐藏（需 can_manage） |
| 审核（通过 / 驳回） | ✅ | ✅ | ✅ |
| 签到（手动 / 扫码 / 动态码） | ✅ | ✅ | ✅ |
| 分组绑定 / 系统配置 / 角色授权 / 审计 | ✅ | 分组绑定 ✅；其余 M7 | 隐藏 |

前端不做分组范围本地判定：活动列表按后端 `activity.list` 已过滤范围返回；越权写操作依赖后端 403 提示（错误消息直接展示）。

## 三、布局（AdminLayout 升级）

- 替换现有占位 [AdminLayout.jsx](../../frontend/src/layouts/AdminLayout.jsx)：左侧 `Sider` 菜单（`Menu`），顶栏品牌 + 主题/语言开关 + 用户下拉（沿用 `AppSettings` / `useAuthStore`）
- 菜单结构：
  - 概览（`/admin`）
  - 活动管理（`/admin/activities`）→ 子菜单「报名运营」随选中活动进入（`/admin/activities/:id/{registrations,review,checkin,stats}`）
  - 模板（`/admin/templates`）
- 活动上下文：列表进入编辑后，子菜单项通过路由参数 `:id` 关联，无需全局 store
- 内容区：统一 `PageHeader` 式页头（活动名 + 状态 Tag + 操作按钮区）

## 四、请求层扩展

新增 [api/admin.js](../../frontend/src/api/admin.js)，按域拆分（复用 [client.js](../../frontend/src/api/client.js) 拦截器、错误映射、i18n）：

| 域 | 函数 | 端点（op） |
|---|---|---|
| activities | list / create / detail / update / remove | `activity.list`、`activity.create`、`activity.detail`、`activity.update`、`activity.delete` |
| groups | tree / bind / unbind | `group.tree`、`activity_group.bind`、`activity_group.unbind` |
| forms | list(=detail) / create / update / delete / field CRUD | `form.create/update/delete`、`form_field.create/update/delete` |
| templates | list / create / update / remove / apply / saveFromActivity | `form_template.*` |
| roster | adminList / adminDetail / review / checkinById / checkinByReceipt / codeCurrent | `registration.admin_list`、`registration.admin_detail`、`registration.review`、`checkin.do`、`checkin.code_current` |
| stats | activityStats / registrationStats / trend | `activity.stats`、`registration.stats`、`registration.trend` |
| export | exportChunk / exportCsv | `registration.export`、`registration.export_csv` |
| roles | myRoles | `user_role.list` |

Query 键约定：`['admin-activities']`、`['admin-activity', id]`、`['roster', activityId, filters]`、`['stats', activityId]`、`['trend', activityId, days]`、`['my-roles']` 等；写操作成功后 `invalidateQueries` 对应键。

## 五、活动管理

### 5.1 活动列表 `/admin/activities`

- 数据：`GET /api/admin/activities`，筛选：状态 Tab（草稿/进行中/已截止/已结束/全部 + 回收站 `include_deleted=1`）、类型、关键字；分页
- 行操作：编辑、状态流转（见下）、删除（仅草稿；二次确认提示）
- 状态流转按钮按转移表开放（非法转移后端 409，直接展示）：

| 当前 | 可用操作 |
|---|---|
| 0 草稿 | 发布（→1） |
| 1 进行中 | 撤回（→0）、截止（→2） |
| 2 已截止 | 重开（→1，`end_time` 未过）、结束（→3） |
| 3 已结束 | — |

### 5.2 活动编辑 `/admin/activities/:id`（含新建）

三段式页面（Tabs 或分段表单）：

1. **基本信息**：名称 / 描述 / 类型 / 报名窗口（`start_time`~`end_time`，dayjs RangePicker）/ 名额（`max_slots`，0=不限）/ `need_review` / `allow_modify` / 状态；保存 `PUT /api/admin/activities/:id`
2. **分组绑定**：`GET /api/admin/groups/tree`（含软删标记）→ TreeSelect 多选；绑定/解绑 `POST|DELETE /api/admin/activities/:id/groups/:groupId`；仅超管 / 活动管理员
3. **活动配置**（ConfigEditor）：`GET|PUT /api/admin/activities/:id/config`，键值类型化输入（布尔 Switch / 数字 InputNumber / 文本 Input / JSON 文本域），白名单键展示中文 label + 说明：`venue_name/venue_address`、`meeting_link/meeting_pwd`、`checkin_mode`（0 现场扫码/1 线上自助/2 线上动态码）、`notify_channel`（0 站内信/1 邮件）

表单设计器在「表单」Tab（见第六节）。

### 5.3 复制与模板

- **复制活动**（决策 D2）：「保存为模板」`form_template.save_from_activity`（当前字段快照）→ 跳新建活动 → 基本信息复制 + 「套用模板」`form_template.apply` → 手动绑定分组 / 配置
- 模板管理页 `/admin/templates`：`GET/POST/PUT/DELETE /api/admin/templates`（`:id` 路由已确认存在）+ 套用入口（选择目标活动，二次确认会覆盖追加字段组）

## 六、表单设计器（FormDesigner，活动编辑内嵌）

参照 [component-design.md](component-design.md) 三：左侧字段类型库 → 中间表单实时预览 → 右侧字段配置面板。

- **表单组**：`form.create/update/delete`（名称 / 排序 / 必填）；删除有字段的表单 → 409，先删字段
- **字段**：`form_field.create/update/delete`，配置面板字段：
  - `field_key`（**冻结**，正则 `[a-z][a-z0-9_]{1,31}`，建议 `student_`/`contact_` 前缀）、`field_type`（**冻结**）
  - `field_label`、`is_required`、`sort_order`（拖拽排序，提交顺序数组）
  - `placeholder`、`default_value`、`is_visible`、`is_editable`、`remark`
  - `options`（单选/多选，活动进行中仅允许追加，删除旧选项 409）
  - `validation` JSON（`min/max/regex/min_length/max_length/min_items/max_items`，按类型生效）
- **field_type 映射**（与报名端 FormBuilder 一致，0~5）：

| type | 控件（antd） |
|---|---|
| 0 文本 | Input（TextArea 由 `validation.max_length` 大时提示） |
| 1 数字 | InputNumber |
| 2 单选 | Radio.Group（options） |
| 3 多选 | Checkbox.Group（options） |
| 4 日期 | DatePicker |
| 5 文件 | Upload（仅配置；报名端上传后存路径/URL） |

- 实时预览区用现有报名端 FormBuilder 渲染只读态，保证「配置所见即所填」
- 新增字段属**只追加**：历史 `registration_data` 引用 `field_id` 始终有效；软删字段不再出现在导出列
- 模板套用按钮（从 TemplatePicker 选择，`form_template.apply`）

## 七、报名运营

### 7.1 名单 `/admin/activities/:id/registrations`

- 数据：`GET /api/admin/activities/:id/registrations`；筛选：状态（0~5 + 全部）、关键字（姓名/学号/手机/凭证号，后端 LIKE 转义）；分页
- **RegistrationTable** 固定列：状态 Tag、`receipt_no`、`queue_no`、姓名、学号、手机、提交时间（`created_at`）、审核人/时间/备注、签到时间、操作
- 行操作：
  - 详情 Drawer：`registration.admin_detail`（`registration` 全列 + `user` + `items[]` 字段值列表，label/value 渲染）
  - 快捷入口：待审 → 审核；已通过 → 签到（跳对应页）
  - 修改/取消：后端无管理端接口，不提供（提示引导用户侧操作）
- **导出**：
  - CSV：`GET /api/admin/activities/:id/export.csv`（UTF-8 BOM，浏览器下载；`max_csv_rows` 超限 422 → 提示改用分块）
  - 分块：`registration.export`（cursor + limit ≤5000），前端循环拉取拼表（后台导出或展示动态列预览），列 = 固定列 + 可见动态字段按 `sort_order`
- 权限：查看需 `can_read_activity`；导出按钮仅 role 1/2 显示（后端 `can_manage_activity` 兜底 + 审计）

### 7.2 审核队列 `/admin/activities/:id/review`

- 数据：名单接口 `status=1`（后端按 `registration_id` 升序，先报名先审）
- 列表展示报名关键信息 + 「审核」按钮 → **ReviewDrawer**：
  - 详情（`admin_detail`）+ 审核结果选择（通过 / 驳回 + `review_remark` 必填）
  - 提交 `POST /api/admin/registrations/:rid/review`（`{ approve, review_remark }`）
- 状态机限制：仅 `status=1` 可审（409 透传）；驳回会释放名额并同步递补候补 → **操作成功后刷新当前页与名单页**（提示「可能已递补候补」）

### 7.3 签到 `/admin/activities/:id/checkin`

按 `activity_config.checkin_mode` 分三种模式：

| 模式 | 形态 | M6 实现 |
|---|---|---|
| 0 现场扫码 | 管理员扫用户报名凭证（`receipt_no`） | CheckinScanner：输入/扫码 `POST /api/admin/checkin/receipt`，成功提示用户姓名 |
| 1 线上自助 | 用户端 `checkin.mine`（M5 已实现） | 本页展示「已签名单」（`status=2` 且 `checkin_time` 非空）+ 手动补签 `POST /api/admin/registrations/:rid/checkin` |
| 2 线上动态码 | 主办方屏幕显示 6 位动态码，用户应用内输码 | 大屏组件轮询 `GET /api/admin/activities/:id/checkin-code`（60s，`expires_in` 倒计时），6 位码大字渲染（可叠加二维码）；已签名单 + 手动补签同左 |

- 签到限制：仅 `status=2` 可签（409「仅已通过的报名可签到」）、已签到 409
- 动态码未配置 `checkin_secret` → 422 提示

### 7.4 单活动看板 `/admin/activities/:id/stats` + 概览 `/admin`

- 单活动：`GET /api/admin/activities/:id/stats` → Statistic 卡片（名额/已占/待审/候补/已签到）+ `status_dist` 状态分布（antd Progress/Table）+ `field_dist` 字段分布（单选/多选计数表）+ `trend` 折线（`days` 可切换 7/30/90，**UTC 日期转本地展示**）
- 概览：`GET /api/admin/activities/stats`（跨活动行表：名称/状态/名额/已占/待审/候补/已签）+ 关键字/日期筛选
- 图表：**不引入图表库**（决策 D1），Statistic + Progress + Table + 轻量 SVG 折线；趋势数据量小，自绘足够

## 八、后端现状核对与缺口

| 项 | 结论 |
|---|---|
| 管理端 API | M2/M3/M4 已全部就绪：活动/表单/字段/模板/分组/配置/名单/审核/签到/动态码/导出/统计 |
| 宿主路由 | 已确认：`user_role.list`（`/api/admin/users/:uid/roles`）、templates `:id`、checkin-code、export.csv 等均存在 |
| 当前用户角色 | `auth.me` 不含角色 → 用 `user_role.list` 查自己（**无新增后端**，前端调用即可） |
| 复制活动 | 无 `activity.copy` → 模板组合方案（决策 D2） |
| 批量操作 | 无批量接口 → 不做（决策 D3） |
| 通知/订阅管理端 | 无接口 → 不做（决策 D5） |
| 线上动态码（用户端输码） | `POST /api/me/checkin/code` 路由已存在；若 M5 未实现入口，M6 在「我的报名」详情补充 `checkin_mode=2` 的输码签到按钮 |

## 九、关键组件清单

| 组件 | 说明 |
|---|---|
| `StatusTag` | 活动状态 / 报名状态 0~5 → 颜色 + 文案（i18n），复用报名端映射 |
| `FormDesigner` | 字段类型库 + 实时预览 + 配置面板（第六节） |
| `RegistrationTable` | 动态列名单表（固定列 + 导出列预览）+ 状态筛选 + 分页 |
| `ReviewDrawer` | 审核详情 + 通过/驳回 + 理由输入 |
| `CheckinScanner` | 凭证输入/扫码 + 结果反馈 |
| `CheckinCodeBoard` | 动态码大屏（轮询 + 倒计时） |
| `DataBoard` | Statistic + Progress + Table + SVG 折线 |
| `ConfigEditor` | 活动配置键值类型化编辑 |
| `TemplatePicker` | 模板选择 Modal（套用） |
| `GroupTreeSelect` | 分组树多选（绑定活动） |

## 十、实现计划

1. **管理端骨架**：路由表 + RequireAdmin + AdminLayout 菜单升级 + `api/admin.js` + i18n keys + `my-roles` 查询
2. **活动管理**：列表（筛选/状态流转/删除）→ 编辑页（基本信息 + 分组 + ConfigEditor）
3. **表单设计器**：表单组管理 + 字段编辑 + 模板保存/套用 + 模板管理页
4. **名单与导出**：RegistrationTable + 详情 Drawer + CSV/分块导出
5. **审核队列**：ReviewDrawer + 列表联动刷新
6. **签到**：CheckinScanner / CheckinCodeBoard / 已签名单；「我的报名」补动态码输码入口
7. **看板**：单活动 stats/trend + 概览 activity.stats
8. **联调验收**：`yarn test` + 浏览器走查（建活动 → 设计表单 → 报名 → 审核 → 签到 → 看板 → 导出）

## 十一、验收标准

| 项 | 验收点 |
|---|---|
| 活动生命周期 | 建 / 编辑 / 发布 / 撤回 / 截止 / 重开 / 结束 / 删（仅草稿）全链路可用，非法流转被 409 拦截 |
| 表单设计 | 六类字段可配可存、`field_key`/`field_type` 冻结、进行中 options 仅追加、软删字段不出现在导出列 |
| 模板 | 保存快照 / 套用生成新活动表单，字段原样复制 |
| 名单 | 状态/关键字筛选与分页正确；详情 Drawer 字段值完整；CSV 带 BOM 可下载、超限 422 有引导 |
| 审核 | 仅待审可审；驳回后候补递补、列表即时刷新 |
| 签到 | 三模式均可完成签到；仅已通过可签、重复签 409；动态码 60s 轮换 |
| 看板 | stats/trend 指标与导出统计契约一致；UTC 日期转本地 |
| 权限 | 审核员只读（按钮隐藏）；越权写操作 403 透传；未登录/无管理角色进 `/admin` 被拦截 |

## 十二、决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 看板不引入图表库（Statistic + Progress + Table + SVG 折线） | 指标少、数据量小；避免 echarts/recharts 体积；后续需要再评估 |
| D2 | 「复制活动」= 保存为模板 + 新建 + 套用组合 | 后端无 `activity.copy`；模板链路已完备且可复用 |
| D3 | 不做批量操作 | 后端无批量接口；避免前端循环串行调用放大失败面 |
| D4 | 当前用户角色用 `user_role.list` 查询并会话缓存 | `auth.me` 不含角色；该路由已存在，无需后端改动 |
| D5 | 管理端不提供通知/订阅功能 | 后端无对应管理端接口 |
| D6 | 名单表用固定列（`admin_list`），导出预览用 export `columns`（固定+动态） | `admin_list` 返回固定字段；动态列仅在导出定义，避免双份装配 |
| D7 | 活动上下文不引入全局 store，靠路由 `:id` 传递 | 单活动操作页无跨页共享状态，保持最小化 |
