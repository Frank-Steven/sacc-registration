# 组件设计

> SACC 报名系统前端设计（[返回前端导航](index.md)）

## 一、组件层次

```
布局层   AuthLayout / UserLayout / AdminLayout
页面层   路由页面组件
功能层   跨页面复用的功能组件（FormBuilder、RegistrationTable …）
基础层   antd 组件 + 少量自定义原子组件
```

依赖方向自上而下，功能层不依赖页面层。

## 二、复用组件清单

| 组件 | 职责 | 关联数据 |
|---|---|---|
| PermissionGuard | 路由 / 菜单按角色过滤 | `user_role` |
| GroupTree | 分组树浏览 / 勾选 / 拖拽管理 | `group` |
| ActivityCard / ActivityTable | 活动展示卡片 / 管理表格 | `activity` |
| FormBuilder | 按 `form_field` 动态渲染表单（校验 / 联动 / 上传 / 预填） | `form_field` |
| FormDesigner | 表单设计器：拖拽（含触控长按）、字段配置、实时预览 | `form` / `form_field` |
| RegistrationStatusTag | 状态徽标（status 0-5 映射颜色 / 文案） | `registration.status` |
| RegistrationTable | 名单表格：动态列、筛选、批量、导出 | `registration_data` |
| ReviewDrawer | 审核抽屉：明细 + 通过 / 驳回 | `registration` |
| CheckinScanner | 扫码签到（线下）/ 线上签到 | `registration` |
| ReceiptModal | 报名凭证 + 二维码 | `receipt_no` |
| NotificationCenter | 通知列表 + 未读角标 | `notification` |
| ConfigEditor | 配置键值编辑（按 `config_type` 渲染控件） | `activity_config` / `system_config` |
| DataBoard | 图表看板 | 统计接口 |
| TemplatePicker | 表单模板选择 / 套用 | `form_template` |
| CommonInfoManager | 常用信息增删改 | `user_common_info` |
| NotifyPrefForm | 通知偏好设置 | `user_notify_pref` |

## 三、核心复杂组件详设

**FormBuilder（动态表单）**
- 输入：`form` + `form_field[]` + 预填数据 + 初始值
- 渲染映射：`field_type` → 控件（文本 Input / 数字 InputNumber / 单选 Radio / 多选 Checkbox / 日期 DatePicker / 文件 Upload）
- 校验：`validation` JSON → AntD rules；条件联动控制字段显隐
- 输出：数据 + 校验状态；支持草稿自动保存

**FormDesigner（表单设计器）**
- 左：可添加的字段类型库
- 中：表单实时预览（拖拽 / 触控长按排序）
- 右：字段配置面板（label / 必填 / 选项 / 默认值 / 校验 / 联动 / 可见性）
- 保存：字段数组提交（只追加语义，下线提示走软删）

**RegistrationTable（名单表格）**
- 动态列：表头按 `form_field` 生成，数据按 `field_key` 展开
- 操作列：详情 / 审核 / 签到
- 批量栏：通过 / 驳回 / 导出
- 筛选：状态 + 任意字段值

**PermissionGuard + usePermission**
- 路由层：按角色渲染
- 按钮层：返回可见性

## 四、状态管理（Zustand）

| store | 状态 | 说明 |
|---|---|---|
| useAuthStore | token、user、roles | 登录 / 登出 / 权限判断 |
| useActivityStore | 活动列表、筛选、分页 | 活动大厅 / 管理 |
| useGroupStore | 分组树 | 大厅筛选 / 分组管理 |
| useRegistrationStore | 报名草稿、当前步骤 | 分步表单 |
| useNotificationStore | 未读数、列表 | 通知中心 |

## 五、服务层（axios）

api 模块按后端域划分：`auth`、`user`、`activity`、`group`、`form`、`template`、`registration`、`review`、`checkin`、`notification`、`config`、`audit`、`statistics`。

- 请求拦截器注入 token
- 响应统一处理：401 登出跳登录、403 无权限提示
- 接口约定返回 `{ code, data, message }`
