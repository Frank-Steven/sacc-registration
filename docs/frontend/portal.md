# M5 前端基础与报名端设计

> SACC 报名系统前端设计 · M5 实现（[返回前端导航](index.md)）
> 依据：[development.md](../development.md) 六-M5；依赖 M1~M4 后端接口（[后端导航](../backend/index.md)）；前端整体设计见 [architecture.md](architecture.md) / [page-design.md](page-design.md) / [interaction-design.md](interaction-design.md) / [component-design.md](component-design.md) / [data-optimization.md](data-optimization.md)。

## 一、范围与定位

M5 是前端第一个落地里程碑，交付 **「报名端可浏览」**：工程可运行、页面可访问、报名全链路可用（注册 → 登录 → 大厅 → 详情 → 分步报名 → 我的报名 / 凭证 → 通知 → 资料）。

| 类别 | 范围 |
|---|---|
| 工程基础 | Vite + React 19 + antd 5 工程、目录骨架、依赖、代理、ESLint/Prettier、构建冒烟 |
| 路由与布局 | 路由表（懒加载分包）+ 三种布局（Auth / User / Admin）+ 守卫（RequireAuth / GuestOnly / 403 / 404） |
| 请求与缓存 | axios 拦截器（token 注入 / 错误统一处理）+ TanStack Query（服务端状态缓存） |
| 状态层 | Zustand：auth / notification（未读）/ registration（报名草稿） |
| 报名端页面 | 工作台、活动大厅、活动详情、分步报名表单（FormBuilder）、我的报名 / 凭证、通知中心、资料（基础资料 / 常用信息 / 通知偏好） |
| 后端前置补齐 | 报名端页面依赖但 M1~M4 未提供的 6 项接口（见 [八](#八后端前置补齐契约先行)，契约先行） |

**范围外（M6 / M7）**：系统管理端页面（分组 / 账号 / 角色 / 配置 / 审计 / 数据治理，M7 规划）；WebSocket 推送（未实现，通知角标等统一 15s 轮询）；图表库（未引入，看板由 Stats 自绘 SVG 折线）。管理端主体（AdminLayout / FormDesigner / ConfigEditor / TemplatePicker 等）已随 M6 完整落地，M5 时仅为骨架 + 占位页 + 403。

## 二、工程搭建

### 2.1 目录结构

按 [development.md](../development.md) 二「前端」部分落地：

```
frontend/src/
├── main.jsx            # ConfigProvider(zhCN) + QueryClientProvider + RouterProvider
├── App.jsx             # Provider 组装 + 全局布局切换
├── router.jsx          # createBrowserRouter：路由表 + 懒加载分包 + 守卫
├── layouts/            # AuthLayout / UserLayout / AdminLayout
├── guards/             # RequireAuth / GuestOnly / Forbidden / NotFound
├── api/                # client.js（拦截器）+ 按域拆分（auth/activity/group/registration/notification/subscribe/user + admin.js）
├── stores/             # auth.js / notification.js / registration.js / preferences.js（Zustand）
├── components/         # 复用组件（FormBuilder、ActivityCard、RegistrationStatusTag、ReceiptModal、NotificationCenter、CommonInfoManager、NotifyPrefForm、FormDesigner、ConfigEditor、TemplatePicker…）
├── pages/              # 报名端页面（auth / Workbench / Activities / MyRegistrations / Notifications / Profile）
├── constants/          # 状态 / 活动形式 / 字段类型枚举映射（错误文案见 api/errors.js）
└── utils/              # 时间格式化（Unix 秒 → dayjs）、错误码映射
```

### 2.2 依赖

| 包 | 用途 | 说明 |
|---|---|---|
| react-router-dom ^7 | 路由 + 守卫 | 新增 |
| @tanstack/react-query ^5 | 服务端状态缓存 | 新增（见 [data-optimization.md](data-optimization.md) 二） |
| zustand ^5 | 客户端状态 | 新增，按域拆 store |
| dayjs | 时间处理 | antd 传递依赖，显式声明 |
| qrcode.react | 报名凭证二维码 | 新增（我的报名详情） |

不引入：`@ant-design/charts`（无图表库，看板 Stats 自绘 SVG 折线）、WebSocket 库（未实现，统一 15s 轮询，决策 2）。

### 2.3 工程配置

- **Vite 代理**：沿用现有 `/api → http://localhost:3000`（[vite.config.js](../../frontend/vite.config.js)）；构建产物由宿主托管（`FRONTEND_DIST`，SPA 回退 `index.html`）。
- **分包**：路由懒加载 `React.lazy` + `Suspense`，报名端 / 管理端（M6 完整管理端，懒加载 chunk）/ 第三方大依赖独立 chunk（[data-optimization.md](data-optimization.md) 七）。
- **React 19 兼容**：antd 版本 < 5.23 时引入 `@ant-design/v5-patch-for-react-19`（决策 1）。

## 三、路由与布局

### 3.1 路由表（M5 落地范围）

按 [architecture.md](architecture.md) 四 路由总览，M5 落地如下（管理端仅骨架占位，M6 完整落地）：

| 路径 | 页面 | 布局 | 守卫 |
|---|---|---|---|
| /login · /register · /forgot-password | 登录 / 注册 / 忘记密码 | AuthLayout | GuestOnly |
| /workbench | 我的工作台 | UserLayout | RequireAuth |
| /activities | 活动大厅 | UserLayout | 需登录（RequireAuth 包裹，未登录跳 /login?redirect=…） |
| /activities/:id | 活动详情 | UserLayout | 需登录（RequireAuth 包裹，未登录跳 /login?redirect=…） |
| /activities/:id/register | 报名表单（分步） | UserLayout | RequireAuth |
| /my-registrations | 我的报名 | UserLayout | RequireAuth |
| /my-registrations/:id | 报名详情 / 凭证 | UserLayout | RequireAuth |
| /notifications | 通知中心 | UserLayout | RequireAuth |
| /profile | 资料 / 常用信息 / 通知偏好 | UserLayout | RequireAuth |
| /admin/* | 管理端（M6 完整实现，见 [admin.md](admin.md)） | AdminLayout | RequireAuth + 角色（RequireAdmin） |

- `/` 重定向：未登录 → `/login`；已登录 → `/workbench`（无公开页面，全部报名端页面需登录）
- 未匹配 → 404 页；已登录但角色不足 → 403 页
- 分包：`pages/auth`、`pages/activities`、`pages/admin`（M6 完整管理端）各自独立 chunk

### 3.2 三种布局

| 布局 | 结构 | M5 落地 |
|---|---|---|
| AuthLayout | 居中卡片 + 品牌区 | ✅ 完整 |
| UserLayout | 顶栏（Logo / 活动大厅 / 我的报名 / 通知角标 / 头像菜单）+ 内容区 | ✅ 完整（移动端菜单收为抽屉，见 [responsive-design.md](responsive-design.md)） |
| AdminLayout | 左菜单（按角色渲染）+ 顶栏（面包屑 / 用户）+ 内容区 | M5 骨架 → M6 已完整实现（菜单 / 报名运营子菜单 / Breadcrumb / 主题语言切换） |

## 四、请求与缓存层

### 4.1 axios（扩展现有 [client.js](../../frontend/src/api/client.js)）

- **请求拦截器**：从 `useAuthStore` 注入 `Authorization: Bearer <token>`（无 token 跳过）
- **响应拦截器**：
  - `code === 0` → 直接返回 `data`
  - `401` → 清 token / user → 跳 `/login?redirect=<当前路径>`
  - `403` → `message` 提示（无权限），留在当前页
  - `409 / 422` → 展示后端 `message`（业务冲突 / 校验失败）
  - 网络错误 / 5xx → 统一兜底提示，交由 Query 重试（指数退避）
- **去重与取消**：Query 并发请求自动合并；页面卸载 AbortController 取消（[data-optimization.md](data-optimization.md) 二）

### 4.2 api 模块（按域拆分）

`auth` / `activity` / `group`（公开树）/ `registration` / `notification` / `subscribe` / `user`（资料 / 常用信息 / 偏好）。每个模块导出命名函数（如 `activity.publicList(params)`、`registration.submit(rid)`），页面与 hooks 只依赖 api 层，不直接拼 URL。

### 4.3 TanStack Query 配置

| 项 | 配置 |
|---|---|
| retry | 指数退避（默认 2 次；401 / 403 不重试） |
| staleTime 分层 | 活动详情 / 分组树 / 表单字段 / 我的角色（只读配置）长缓存（staleTime 5min）；活动列表 60s；名单类动态数据不缓存（[data-optimization.md](data-optimization.md) 三） |
| 失效策略 | 写操作成功后 `invalidateQueries` 对应域（如提交后失效「我的报名」） |
| 持久化 | 仅客户端状态持久化 localStorage：`sacc.auth`（会话）/ `sacc.registration-draft`（报名草稿）/ `sacc.preferences`（界面偏好）；服务端数据不落 localStorage（决策 3） |

### 4.4 错误码同步

前端 `api/errors.js` 与宿主已同步（[errors.js](../../frontend/src/api/errors.js)）；业务提示文案集中在 `api/errors.js` 的 `ErrorMessage` 常量，页面统一消费，不再散落硬编码。

## 五、状态层（Zustand）

边界：**服务端状态进 TanStack Query，客户端状态进 Zustand**（[data-optimization.md](data-optimization.md) 八）。

| store | 状态 | 行为 |
|---|---|---|
| useAuthStore | token、user（**roles 不入 store**） | 登录 / 注册成功写入（localStorage 持久化，`sacc.auth`）；启动时 `GET /api/auth/me` 校验恢复；登出清空并跳登录；角色由 `useQuery(['my-roles', uid])` 获取（`user_role.list`，管理端守卫与按钮显隐消费） |
| useNotificationStore | unreadCount | 未读轮询（15s）更新；单条已读 / 全部已读后递减；驱动顶栏角标 |
| useRegistrationStore | 草稿表单值、current_step | 分步表单本地草稿（`sacc.registration-draft`）与「继续上次填写」恢复；提交成功清空 |
| usePreferencesStore | theme、locale | 界面偏好；本地 `sacc.preferences` 持久化，登录后经 `/me/prefs` 跨设备同步 |

## 六、报名端页面详设

统一约定：列表筛选 + 分页 + 删除 / 取消二次确认（[interaction-design.md](interaction-design.md) 三）；时间统一走 `utils/formatTime`（Unix 秒 → 本地时间）。

### 6.1 登录 / 注册 / 忘记密码（AuthLayout）

| 页面 | 接口 | 要点 |
|---|---|---|
| 登录 | `POST /api/auth/login` | 401 统一提示「用户名或密码错误」；403 显示账号禁用 / 锁定及剩余时间；成功写入 auth store 并按 `redirect` 回跳 |
| 注册 | `POST /api/auth/register` | 成功即返回 token 自动登录 → 跳工作台；409 提示用户名已存在 |
| 忘记密码 | `POST /api/auth/password/reset` → `POST /api/auth/password/reset/confirm` | 输入 `user.email` 申请 → 重置页（token + 新密码 + 二次确认）；开发期接口直接返回 token（M1 临时，见 [auth.md](../backend/auth.md)） |

### 6.2 工作台 `/workbench`

- 数据：`GET /api/me/registrations`（状态分组 Tab：草稿 0 / 待审核 1 / 已通过 2 / 候补 5 / 已取消 4）
- 快捷入口：活动大厅 / 我的报名 / 资料（常用信息）
- 卡片行为：草稿 →「继续填写」跳报名表单（恢复草稿）；候补 → 显示排名；未通过 → 显示驳回理由 +「修改并重新提交」

### 6.3 活动大厅 `/activities`

- 左侧分组树：`GET /api/groups/tree`（新增公开接口，见 [八](#八后端前置补齐契约先行)），选中分组 → `group_id` 筛选（含子分组递归，后端判定）
- 活动卡片：`GET /api/activities`（`activity_type` / `keyword` / `group_id`；`taken` 名额进度条）
- 卡片内容：名称、形式标签、报名窗口、名额进度（taken / max_slots）、`need_review` 标记；点击进详情
- 加载：后端现 `LIMIT 50`（[activity.cpp](../../backend/src/config/activity.cpp) public_list），前端「加载更多」按页追加
- 大厅仅展示「进行中且未过期」活动（public_list 语义），不提供状态筛选（决策 4）

### 6.4 活动详情 `/activities/:id`

- 数据：`GET /api/activities/:id`（补齐 `forms[]` 后含表单字段定义）
- 信息区：名称 / 形式 / 报名窗口 / 描述；线下形式展示场地配置（`activity_config` venue_*）、线上形式展示参会链接（meeting_link）
- 报名按钮状态机（[page-design.md](page-design.md) 三）：未开始 / 进行中 / 已截止 / 已满 / 已报名（不满足条件置灰并提示原因）
- 订阅提醒开关：`GET /api/me/subscribes` + `POST|DELETE /api/me/subscribe/:activityId`
- 字段只读预览：`forms[].fields[]` 渲染只读表单（供查看本次需填内容）

### 6.5 报名表单 `/activities/:id/register`（核心）

- 数据：活动详情（forms + fields）+ 预填（`GET /api/auth/me` 基础资料 + `GET /api/me/common-info` 常用信息，按 `field_key` 匹配，冲突以本次填写为准，见 [principles.md](../backend/principles.md)）
- FormBuilder 分步渲染：步骤条 = 多表单按 `sort_order`；每步一个 `form` 的动态表单（[component-design.md](component-design.md) 三）
- 文件类型字段（`field_type=5`）**未开放**：报名端渲染为 disabled Input + 提示（「敬请期待」），不可填写
- 草稿：输入防抖 2s → localStorage + `PUT /api/me/registrations/:rid`（`fields[]` + `current_step`，增量 upsert）；再次进入提示「继续上次填写」（[data-optimization.md](data-optimization.md) 六）
- 提交：`POST /api/me/registrations/:rid/submit` → 按 `need_review` 展示「待审核」或成功页（ReceiptModal 凭证 + 二维码）；满员 → 提示候补及 `queue_no`
- 校验：前端按 `validation` JSON 预校验（即时提示），提交由后端兜底（422 指出首个失败字段）
- 首次进入：`POST /api/activities/:id/registration` 创建草稿（复用已取消记录，409 防重复报名）

### 6.6 我的报名 `/my-registrations` 与详情 `/my-registrations/:id`

- 列表：`GET /api/me/registrations`（状态筛选 + 分页）
- 详情：`GET /api/me/registrations/:rid` → `registration` + `items[]`（label / value 渲染）
- 凭证：ReceiptModal（`receipt_no` + qrcode.react 二维码）
- 操作按状态机控制（[registration.md](../backend/registration.md) 一）：
  - 草稿 → 继续填写；`allow_modify=1` 且待审核 → 编辑（进报名表单）
  - 状态 0/1/2/5 且窗口内 → 取消（二次确认，提示名额释放）
  - `status=2` 且未签到者显示「签到」与「动态码输码」两按钮：自助签到 `POST /api/me/registrations/:rid/checkin`（checkin_mode=1）；动态码输码 `POST /api/me/checkin/code`（checkin_mode=2 输码入口，6 位码校验）

### 6.7 通知中心 `/notifications`

- 列表：`GET /api/me/notifications`（未读 / 全部 Tab，分页）
- 已读：单条 `PUT /api/me/notifications/:nid/read`、全部 `PUT /api/me/notifications/read-all`
- 顶栏角标：`GET /api/me/notifications/unread-count` 15s 轮询（决策 2；无 WebSocket，统一轮询）
- 点击跳转：审核结果 / 递补通知 → 对应报名详情

### 6.8 资料 `/profile`

三个 Tab（[page-design.md](page-design.md) 三）：

| Tab | 接口 | 说明 |
|---|---|---|
| 基础资料 | `GET /api/auth/me` + `PUT /api/me/profile`（新增 B4） | name / student_id / college / phone / email，保存前校验 |
| 常用信息 | `GET/PUT/DELETE /api/me/common-info`（新增 B5） | `field_key` 增删改；报名表单预填数据源 |
| 通知偏好 | `GET/PUT/DELETE /api/me/notify-prefs`（新增 B6） | 按通知类型选渠道（站内信 / 邮件），删除恢复默认 |

## 七、关键组件

按 [component-design.md](component-design.md) 二，M5 落地报名端相关组件：

| 组件 | M5 落地 | 说明 |
|---|---|---|
| FormBuilder | ✅ 完整 | `field_type` → 控件映射（文本 / 数字 / 单选 / 多选 / 日期 / 文件）；`validation` JSON → antd rules；联动显隐（只挂载可见字段）；预填；草稿保存钩子 |
| ActivityCard | ✅ | 活动卡片 + 名额进度 |
| RegistrationStatusTag | ✅ | status 0~5 → 颜色 / 文案（[interaction-design.md](interaction-design.md) 二） |
| ReceiptModal | ✅ | 凭证 + 二维码 |
| NotificationCenter | ✅ | 列表 + 未读角标 + 已读操作 |
| CommonInfoManager / NotifyPrefForm | ✅ | 资料页 Tab |
| GroupTree | ⚠️ 只读 | 大厅左侧折叠树（拖拽管理属 M7） |
| FormDesigner / ConfigEditor / TemplatePicker | ✅ 已落地（M6） | 管理端（见 [admin.md](admin.md) 六 / 九） |
| RegistrationTable / ReviewDrawer / CheckinScanner / DataBoard | ⚠️ 内联实现 | 无独立组件，内联于对应管理页面（[admin.md](admin.md) 九） |

> 注：该表为 M5 时点快照，M6 后管理端组件已落地；RegistrationTable 等以页面内联实现存在。

## 八、后端前置补齐（契约先行）

报名端页面依赖以下接口，M1~M4 未提供。按项目「契约先行」约定（[dev-guide.md](../dev-guide.md) 二）先定契约，随 M5 一并实现（backend ops + dispatch + host 路由 + 测试），前端 api 层同步。

| # | 接口 | 契约 | 消费页面 |
|---|---|---|---|
| B1 | `activity.public_detail` **补齐 `forms[]`（含 `fields[]`）** | 契约已定义（[config.md](../backend/config.md) 2.2「活动详情 + 分组 + 表单字段定义」），当前实现仅返回 groups（[activity.cpp](../../backend/src/config/activity.cpp#L374-L383)），需对齐 | 详情 / 报名表单 |
| B2 | `activity.public_list` 新增 `group_id` 筛选 + `taken` | `group_id` 可选（含子分组递归）；每行 `taken = COUNT(status IN (1,2))` 子查询（LIMIT 50，走 `idx_registration_activity_status`） | 活动大厅 |
| B3 | `GET /api/groups/tree` → `group.public_tree` | 非软删分组树（id / name / children），不含管理语义，供报名端筛选 | 活动大厅 |
| B4 | `PUT /api/me/profile` → `user.update` | body：`name` `student_id` `college` `phone` `email`；返回 `auth.me` 同构 profile | 资料 |
| B5 | `GET /api/me/common-info` / `PUT` / `DELETE ?key=` → `user_common_info.list / save / delete` | save 单条 `{ field_key, field_label, field_value }`（`(uid, field_key)` upsert）；delete 按 `field_key` | 资料 / 报名预填 |
| B6 | `GET /api/me/notify-prefs` / `PUT` / `DELETE /:type` → `user_notify_pref.list / set / delete` | set 单条 `{ notify_type, channel }` upsert；delete 恢复默认渠道 | 资料 |

- 均走 `requireAuth`（宿主 JWT → uid 透传），本人维度鉴权（同 M3 `/api/me/*` 语义）
- B1 仅后端实现补齐（无新路由）；B2 复用现有 `/api/activities`；B3~B6 新增宿主路由
- 涉及表（M1 已建，见 [0001_init.sql](../../db/migrations/0001_init.sql)）：`user_common_info` / `user_notify_pref`

## 九、实现计划

1. **工程基础**：依赖安装、目录骨架、vite / lint 配置、路由分包、三布局与守卫
2. **请求层**：client.js 扩展拦截器 + QueryClient + 错误码文案 + api 模块拆分
3. **状态层**：useAuthStore / useNotificationStore / useRegistrationStore
4. **账号页**：登录 / 注册 / 忘记密码
5. **大厅 + 详情**：公开分组树、活动卡片、订阅开关
6. **报名表单**：FormBuilder（控件映射 / 校验 / 联动 / 草稿）+ 分步流程 + 凭证二维码
7. **我的报名 + 通知中心 + 资料**
8. **后端前置补齐 B1~B6**（与前端并行）：backend ops + dispatch + host 路由 + native / 集成测试
9. **联调验收**：`yarn test`（前端构建冒烟）+ 手工走查报名全链路

## 十、验收标准

| 项 | 验收点 |
|---|---|
| 工程 | `yarn test` 前端构建冒烟通过；`/api` 开发代理可用 |
| 路由 | 三布局正确；未登录访问受保护路由 → `/login` 并回跳；角色不足 → 403 页 |
| 请求 | token 自动注入；401 自动登出；403 / 409 / 422 按后端 message 提示；断网按退避重试 |
| 账号 | 注册 → 自动登录 → 工作台；登录失败提示；忘记密码全流程 |
| 大厅 / 详情 | 分组树筛选 + 名额进度；报名按钮按窗口 / 名额 / 唯一性置灰并提示原因 |
| 报名 | 分步表单 + 即时校验 + 联动；草稿防抖保存与恢复；提交 → 待审核或凭证二维码；满员候补提示 |
| 我的报名 | 状态 Tab + 筛选；凭证 / 取消（二次确认）/ 线上签到（`checkin_mode=1`）与动态码输码（`checkin_mode=2`） |
| 通知 | 未读角标轮询；已读 / 全部已读；点击跳转关联对象 |
| 资料 | 基础资料修改、常用信息增删改、通知偏好设置，落库后生效并用于报名预填 |
| 多端 | 手机端报名主路径可用（全功能适配属 M7，[responsive-design.md](responsive-design.md)） |

## 十一、决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | antd 升级至 ≥5.23（原生 React 19 支持）或引入 `@ant-design/v5-patch-for-react-19` | 当前 `antd ^5.21` 对 React 19 未官方支持，避免运行时兼容问题 |
| 2 | 通知未读用 15s 轮询（无 WebSocket；全站 Query `refetchInterval` 15s 统一刷新） | 宿主 WS 未实现；轮询满足交付，切换点收敛在 api / hook 层 |
| 3 | 服务端状态进 TanStack Query、客户端状态进 Zustand | 与 [data-optimization.md](data-optimization.md) 八一致，缓存 / 去重 / 失效由 Query 统一管理 |
| 4 | 报名端大厅仅「进行中且未过期」活动（public_list 现状），不提供状态筛选 | 报名端语义即当前可报名活动；历史活动由「我的报名」覆盖 |
| 5 | 大厅名额进度由后端 `taken` 子查询提供，而非前端拉全量聚合 | 请求下推原则（[data-optimization.md](data-optimization.md) 一）；LIMIT 50 场景成本可控 |
| 6 | 公开分组树新增 `group.public_tree`，不复用管理端 `group.tree` | 管理树含软删标记与权限语义，公开面需独立只读契约 |
| 7 | 资料页编辑（user.update / 常用信息 / 通知偏好）纳入 M5，后端契约先行补齐 | [page-design.md](page-design.md) 将「资料」列为报名端页面；表 M1 已建，仅缺 ops |
| 8 | `@ant-design/charts` 未引入 | 看板最终由 Stats 自绘 SVG 折线（[admin.md](admin.md) 决策 D1），避免主包体积膨胀 |
| 9 | 常用信息 / 通知偏好均为**单条 upsert**（`(uid, key)` 唯一），删除恢复默认 | 偏好未配置的类型按活动默认渠道发送（[user-layer.md](../backend/user-layer.md)），整表覆盖会误清默认语义 |
