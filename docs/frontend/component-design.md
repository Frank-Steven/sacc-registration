# 组件设计

> SACC 报名系统前端设计（[返回前端导航](index.md)）

## 一、组件层次

```
布局层   AuthLayout / UserLayout / AdminLayout
页面层   路由页面组件
功能层   跨页面复用的功能组件（FormBuilder、FormDesigner …；名单/审核/签到/看板等为页面内联实现）
基础层   antd 组件 + 少量自定义原子组件
```

依赖方向自上而下，功能层不依赖页面层。

## 二、复用组件清单

| 组件 | 职责 | 关联数据 |
|---|---|---|
| RequireAuth / RequireAdmin / GuestOnly / Forbidden / NotFound | 路由守卫：登录 / 管理角色 / 仅游客 / 403 / 404 页 | `user_role`（RequireAdmin） |
| GroupTree | 分组树浏览 / 勾选（拖拽管理属 M7） | `group` |
| ActivityCard | 活动展示卡片 | `activity` |
| ActivityTable | ⚠️ 内联实现于 [pages/admin/Activities.jsx](../../frontend/src/pages/admin/Activities.jsx)：活动管理表格 | `activity` |
| FormBuilder | 按 `form_field` 动态渲染表单（校验 / 联动 / 预填；文件字段未开放） | `form_field` |
| FormDesigner | 表单设计器：表单组 Collapse 列表 + 字段 Modal 编辑 + 上移 / 下移 | `form` / `form_field` |
| RegistrationStatusTag / ActivityStatusTag | 状态徽标（报名 0-5 / 活动 0-3 映射颜色 / 文案） | `registration.status` / `activity.status` |
| RegistrationTable | ⚠️ 内联实现于 [pages/admin/Registrations.jsx](../../frontend/src/pages/admin/Registrations.jsx)：固定列名单、筛选、导出 | `registration_data` |
| ReviewDrawer | ⚠️ 内联实现于 [pages/admin/Review.jsx](../../frontend/src/pages/admin/Review.jsx)：审核明细 + 通过 / 驳回 | `registration` |
| CheckinScanner | ⚠️ 内联实现于 [pages/admin/Checkin.jsx](../../frontend/src/pages/admin/Checkin.jsx)：凭证输入签到（线下） | `registration` |
| CheckinCodeBoard | ⚠️ 内联实现于 [pages/admin/Checkin.jsx](../../frontend/src/pages/admin/Checkin.jsx)：动态码大屏 | `checkin.code` |
| ReceiptModal | 报名凭证 + 二维码 | `receipt_no` |
| NotificationCenter | 通知列表 + 未读角标 | `notification` |
| ConfigEditor | 活动配置键值编辑（按 `config_type` 渲染控件） | `activity_config` |
| DataBoard | ⚠️ 内联实现于 [pages/admin/Stats.jsx](../../frontend/src/pages/admin/Stats.jsx)：指标卡 + 分布 + 自绘 SVG 折线 | 统计接口 |
| TemplatePicker | 表单模板选择 / 套用 | `form_template` |
| CommonInfoManager | 常用信息增删改 | `user_common_info` |
| NotifyPrefForm | 通知偏好设置 | `user_notify_pref` |

## 三、核心复杂组件详设

**FormBuilder（动态表单）**
- 输入：`form` + `form_field[]` + 预填数据 + 初始值
- 渲染映射：`field_type` → 控件（文本 Input / 数字 InputNumber / 单选 Radio / 多选 Checkbox / 日期 DatePicker / 文件 disabled Input + 提示（未开放））
- 校验：`validation` JSON → AntD rules；条件联动控制字段显隐
- 输出：数据 + 校验状态；支持草稿自动保存

**FormDesigner（表单设计器）**
- 实际形态：表单组 `Collapse` 列表 + 字段 Modal 编辑 + 上移 / 下移按钮排序（**无拖拽、无实时预览**，早期三栏设计未落地）
- 字段 Modal 可编辑：label / 必填 / 选项 / 默认值 / 校验 / 排序
- `is_visible` / `is_editable` / `remark` 不可编辑：仅列表只读展示（如 `is_visible=false` 标注 hidden）
- 保存：字段保存即提交（只追加语义，下线提示走软删）

**RegistrationTable（名单表格）**
- 固定列：status / receipt_no / queue_no / user_name / student_id / phone / created_at / review_time / 操作（无动态列、无字段值筛选、无批量）
- 操作：详情 Drawer（含 `items[]` 字段值）；待审 → 审核、已通过 → 签到 快捷入口
- 导出：CSV（BOM）+ 全量分块（cursor 游标循环拉取拼表）
- 筛选：状态 + 关键字（后端 LIKE）

**RequireAuth / RequireAdmin / GuestOnly / Forbidden / NotFound（守卫）**
- 路由层：RequireAuth 未登录跳 `/login?redirect=`；RequireAdmin 无管理角色跳 `/403`（roles 加载期先放行）
- 按钮层：管理端按 `useQuery(['my-roles', uid])` 返回角色控制显隐

## 四、状态管理（Zustand）

| store | 状态 | 说明 |
|---|---|---|
| useAuthStore | token、user | 登录 / 登出（roles 不入 store，角色由 `useQuery(['my-roles', uid])` 获取） |
| useNotificationStore | unreadCount | 未读角标（15s 轮询）；列表走 Query |
| useRegistrationStore | 报名草稿、当前步骤 | 分步表单草稿 |
| usePreferencesStore | theme、locale | 界面偏好；本地持久化 + 登录后经 `/me/prefs` 跨设备同步 |

> 活动列表 / 分组树等服务端状态一律走 TanStack Query，不设 useActivityStore / useGroupStore。

## 五、服务层（axios）

api 模块按后端域划分（[api/index.js](../../frontend/src/api/index.js)）：`auth`、`activity`、`group`、`registration`、`notification`、`subscribe`、`user` 共 7 域；管理端另立 [api/admin.js](../../frontend/src/api/admin.js)，form / template / roster（review / checkin / export 并入）/ stats / roles 统一归入 admin 域。

- 请求拦截器注入 token
- 响应统一处理：401 登出跳登录、403 无权限提示
- 接口约定返回 `{ code, data, message }`
