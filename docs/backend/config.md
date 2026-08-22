# 配置层与权限（M2 实现）

> SACC 报名系统后端设计（[返回后端导航](index.md)）· 对应里程碑 M2 配置层
>
> **范围**：活动 CRUD 与状态流转、分组树与活动绑定、表单/字段（只追加/软删）、模板快照套用、活动/系统配置、角色授权与分组范围权限、审计日志。表结构见 [config-layer.md](config-layer.md)，实现见 [development.md](../development.md) M2。

## 一、权限模型

### 1.1 角色

| role_id | 名称 | 范围 | 能力 |
|---|---|---|---|
| 1 | 超级管理员 | 全范围 | 一切（含分组管理、角色授权、系统配置、审计） |
| 2 | 活动管理员 | 分组范围 | 活动 / 表单 / 字段 / 模板套用 / 活动配置 |
| 3 | 审核员 | 分组范围 | 活动只读（审核操作属 M3） |

> 角色种子数据由迁移 `0002_seed_roles.sql` 写入（幂等）。

### 1.2 分组范围判定（递归 CTE）

`user_role.group_id` 为 **NULL = 全范围**；非 NULL 表示授权该分组**及全部子分组**：

```sql
-- 活动 A 是否落在用户授权分组 G（含子树）内
WITH RECURSIVE scope(gid) AS (
  SELECT ? /* 授权分组 */ UNION ALL
  SELECT g.group_id FROM "group" g JOIN scope s ON g.parent_id = s.gid
)
SELECT 1 FROM activity_group ag JOIN scope s ON ag.group_id = s.gid
WHERE ag.activity_id = ? AND ag.group_id IS NOT NULL LIMIT 1;
```

- **命中判定**：`user_role` 中任一角色命中（全范围 或 分组范围命中）即授权；超级管理员忽略分组条件。
- 新建活动不绑定分组时视为**未授权任何分组**，活动管理员无法查看（先绑定再操作）。

### 1.3 操作权限矩阵

| 操作域 | 超级管理员 | 活动管理员 | 审核员 |
|---|---|---|---|
| 活动 CRUD / 状态流转 | ✅ 全部 | ✅ 授权分组内 | 只读 |
| 分组树管理 / 活动绑定 | ✅ | ✅ 绑定到授权分组内活动 | ❌ |
| 表单 / 字段 | ✅ | ✅ 授权分组内活动 | 只读 |
| 模板（含套用） | ✅ | ✅ 套用到授权分组内活动 | ❌ |
| 活动配置 | ✅ | ✅ 授权分组内 | 只读 |
| 系统配置 | ✅ | ❌ | ❌ |
| 角色授权（user_role） | ✅ | ❌ | ❌ |
| 审计日志 | ✅ 全部 | ✅ 授权分组内 | ❌ |

### 1.4 鉴权约定

- 权限判定**在 wasm 内完成**：wasm op 入参携带 `uid`（宿主从 JWT 解析透传）与目标 `activity_id` / `group_id`，模块内校验后执行——与 M1「密码哈希在模块内完成」一致，权限逻辑不依赖宿主。
- 宿主仅负责 JWT 校验与 `uid` 透传；未登录统一 401，登录但无权限统一 403。

## 二、接口契约

统一响应 `{ code, data?, message? }`；错误码复用现有登记（无新增码，403 用于权限不足）。

### 2.1 wasm ops（`wasm_invoke` 分发）

**活动**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `activity.create` | `name` 必填 + `description` `activity_type` `start_time` `end_time` `max_slots` `need_review` `allow_modify` `group_ids[]` | `{ activity_id }` | 422 参数 / 403 无权限 |
| `activity.update` | `activity_id` + 可改字段（含 `status` 流转） | `{ activity_id }` | 403 / 404 / 409 状态转移非法 |
| `activity.detail` | `activity_id` | 活动资料 + `groups[]` + `forms[]`（各含 `fields[]`） | 404 |
| `activity.list` | `page` `page_size` `status` `activity_type` `keyword` `include_deleted` | `{ items[], total }`（范围内；报名端另见 host 路由） | - |
| `activity.delete` | `activity_id` | `{ ok: true }` | 403 / 409 仅草稿可删 |

**分组**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `group.create` | `name` 必填 + `parent_id` `sort_order` | `{ group_id }` | 422 / 403 仅超管 |
| `group.update` | `group_id` + `name` `parent_id` `sort_order` | `{ ok: true }` | 403 / 404 / 409 移动至自身子树 |
| `group.delete` | `group_id` | `{ ok: true }` | 403 / 409 有子分组或活动绑定 |
| `group.tree` | - | 完整树（含软删标记） | 403 |
| `activity_group.bind` | `activity_id` `group_id` | `{ ok: true }` | 403 分组不在授权范围 |
| `activity_group.unbind` | `activity_id` `group_id` | `{ ok: true }` | 403 |
| `activity_group.list` | `activity_id` | `[ group ]` | 404 |

**表单 / 字段**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `form.create` | `activity_id` `name` + `sort_order` `is_required` | `{ form_id }` | 403 / 404 |
| `form.update` | `form_id` + `name` `sort_order` `is_required` | `{ ok: true }` | 403 / 404 |
| `form.delete` | `form_id` | `{ ok: true }` | 403 / 409 有字段需先删字段 |
| `form.detail` | `form_id` | `{ form, fields[] }`（不含已删字段） | 404 |
| `form_field.create` | `form_id` `field_key` `field_label` `field_type` + 可选 `is_required` `options` `default_value` `placeholder` `validation` `is_visible` `is_editable` `remark` `sort_order` | `{ field_id }` | 422 key 非法或 type 缺省 / 403 |
| `form_field.update` | `field_id` + 可改字段（**`field_key` / `field_type` 冻结**） | `{ ok: true }` | 422 / 403 / 404 / 409 改冻结字段 |
| `form_field.delete` | `field_id` | `{ ok: true }` | 403 / 404 |

**模板**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `form_template.create` | `name` 必填 + `description` `fields_json` | `{ template_id }` | 422 |
| `form_template.update` | `template_id` + `name` `description` `fields_json` | `{ ok: true }` | 404 |
| `form_template.delete` | `template_id` | `{ ok: true }` | 404 |
| `form_template.list` | - | `[ template ]` | - |
| `form_template.save_from_activity` | `activity_id` `name` | `{ template_id }` | 403 / 404 |
| `form_template.apply` | `template_id` `activity_id` | `{ form_id }`（复制字段生成 `form` + `form_field`） | 403 活动不在授权范围 / 404 |

**配置**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `activity_config.set` | `activity_id` `key` `value` | `{ ok: true }` | 422 key 未登记或值类型不符 / 403 |
| `activity_config.get` | `activity_id` `key` | `{ value, type, remark }` | 404 |
| `activity_config.list` | `activity_id` | `[ { key, value, type, remark } ]` | - |
| `system_config.set` | `key` `value` | `{ ok: true }` | 422 / 403 仅超管 |
| `system_config.get` | `key` | `{ value, type, description }` | 404 |
| `system_config.list` | - | `[ ... ]` | - |

**角色 / 授权 / 审计**

| op | 参数 | 返回 `data` | 错误 |
|---|---|---|---|
| `role.list` | - | `[ role ]` | - |
| `user_role.grant` | `uid` `role_id` + 可选 `group_id` | `{ ok: true }` | 403 仅超管 / 422 |
| `user_role.revoke` | `uid` `role_id` | `{ ok: true }` | 403 / 404 |
| `user_role.list` | `uid` | `[ { role_id, name, group_id } ]` | - |
| `audit_log.list` | `page` `page_size` `operator_uid` `action` `start_time` `end_time` | `{ items[], total }` | 403 |

### 2.2 host HTTP 路由

管理端统一 **`/api/admin/*`**（需 Bearer token；宿主校验后透传 `uid` 入 wasm）：

| 方法 | 路径 | wasm op |
|---|---|---|
| GET / POST | `/api/admin/activities` | `activity.list` / `activity.create` |
| GET / PUT / DELETE | `/api/admin/activities/:id` | `activity.detail` / `activity.update` / `activity.delete` |
| GET / POST | `/api/admin/activities/:id/forms` | `activity.detail`（forms）/ `form.create` |
| PUT / DELETE | `/api/admin/forms/:id` | `form.update` / `form.delete` |
| GET / POST | `/api/admin/forms/:id/fields` | `form.detail`（fields）/ `form_field.create` |
| PUT / DELETE | `/api/admin/fields/:id` | `form_field.update` / `form_field.delete` |
| GET | `/api/admin/groups/tree` | `group.tree` |
| POST | `/api/admin/groups` | `group.create` |
| PUT / DELETE | `/api/admin/groups/:id` | `group.update` / `group.delete` |
| POST / DELETE | `/api/admin/activities/:id/groups/:groupId` | `activity_group.bind` / `activity_group.unbind` |
| GET / PUT | `/api/admin/activities/:id/config` | `activity_config.list` / `activity_config.set`（批量） |
| GET / PUT | `/api/admin/system/config` | `system_config.list` / `system_config.set`（批量） |
| GET / POST / PUT / DELETE | `/api/admin/templates` | `form_template.list` / `create` / `update` / `delete` |
| POST | `/api/admin/templates/:id/apply` | `form_template.apply` |
| GET | `/api/admin/roles` | `role.list` |
| GET | `/api/admin/users/:uid/roles` | `user_role.list`（按目标用户查询） |
| POST | `/api/admin/roles/:roleId/users` | `user_role.grant`（`role_id` 取路径，body 传 `target_uid`/`group_id`） |
| DELETE | `/api/admin/user-roles/:uid/:roleId` | `user_role.revoke` |
| GET | `/api/admin/audit-logs` | `audit_log.list` |

报名端（公开，仅读）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/activities` | 可报名活动列表（`status==1` 且未过期） |
| GET | `/api/activities/:id` | 活动详情 + 分组 + 表单字段定义（供报名渲染） |

> **宿主路由扩展**：现有 [server.js](../index.md) 路由为正则匹配，M2 起支持字符串路径 + `:param` 捕获注入 `ctx.params`（已实现）。

## 三、业务规则

### 3.1 活动状态流转

| 从 \\ 到 | 0 草稿 | 1 进行中 | 2 已截止 | 3 已结束 |
|---|---|---|---|---|
| 0 草稿 | - | ✅ 发布 | ❌ | ❌ |
| 1 进行中 | ✅ 撤回 | - | ✅ 截止 | ❌ |
| 2 已截止 | ❌ | ✅ 重开（`end_time` 未过） | - | ✅ 结束 |
| 3 已结束 | ❌ | ❌ | ❌ | - |

- 报名端可报名条件：`status == 1` **且** `now` ∈ `[start_time, end_time]`（status 为管理意图，时间为事实）。
- 撤回发布（1→0）：允许，报名端不再展示；已产生的报名数据保留。
- 非法转移返回 409。

### 3.2 活动 / 分组 / 字段删除限制

- **活动**：仅 `status == 0`（草稿）可软删；已发布返回 409 提示先截止/结束。
- **分组**：存在子分组或 `activity_group` 绑定 → 409；软删后报名端不可见。
- **表单**：存在未删字段 → 409（先删字段再删表单）。
- **字段**：软删，历史 `registration_data` 引用（`field_id`）始终有效（定义与数据分离）。

### 3.3 字段规则

- `field_key`：`[a-z][a-z0-9_]{1,31}`，**不可变更**；建议命名空间化前缀（`student_` / `contact_`）防跨活动误匹配（预填 `user_common_info` 依赖）。
- **冻结项**：`field_key`、`field_type`（改类型破坏历史数据）。
- 运行中可改：`field_label` `placeholder` `sort_order` `is_required` `is_visible` `is_editable` `default_value` `validation`。
- `options`（单选/多选）：活动未进行时自由修改；**进行中仅允许追加选项**（防已提交数据失效），删除旧选项 → 409。
- `validation` JSON 结构：`{ "min"?, "max"?, "regex"?, "min_length"?, "max_length"?, "min_items"?, "max_items"? }`（按 `field_type` 生效，类型不符 422）。

### 3.4 模板套用

- `save_from_activity`：按活动表单当前字段（含已删？**不含**已删字段）生成 `fields_json` 快照。
- `apply`：按快照生成新活动下的 `form` + `form_field`（`field_key` 原样复制），`form_id` 返回。

### 3.5 配置

- **key 常量枚举登记**（代码常量 + 白名单校验，未登记 key 拒绝 422）：
  - 活动级：`venue_name` / `venue_address`（线下）、`meeting_link` / `meeting_pwd`（线上）、`checkin_mode`（0 现场扫码 / 1 线上）、`notify_channel`（0 站内信 / 1 邮件）
  - 全局：`site_name`、`max_upload_size`
- `set` 校验 `config_type` 与值格式：0 布尔 / 1 数字 / 2 文本 / 3 JSON；不符 422。

### 3.6 审计日志

- 以下写操作自动写入 `audit_log`（`action` 由 op 映射）：`activity.create/update/delete`、`group.create/update/delete`、`activity_group.bind/unbind`、`form.create/update/delete`、`form_field.create/update/delete`、`form_template.create/update/delete/apply`、`activity_config.set`、`system_config.set`、`user_role.grant/revoke`。
- `target` = 对象标识（`activity:12` / `field:34`），`detail` = 变更 JSON（update 记录变更字段 before/after）。

## 四、错误码

复用现有登记：[errors.js](../../host/src/errors.js) ↔ 前端。`403` = 授权分组外/角色不足，`409` = 状态冲突/删除限制/冻结字段，`422` = 参数与规则校验，`404` = 对象不存在（或不可见）。

## 五、实现计划

- **backend 新增 `src/config/`**：
  - `authz.cpp/h`：权限判定 helper（角色命中 + 分组范围 CTE + 活动范围校验）
  - `activity.cpp`：CRUD + 状态转移表
  - `group.cpp`：分组树 CRUD + `activity_group` 绑定 + 子树校验
  - `form.cpp`：表单 / 字段 CRUD + 冻结项 + options 追加限制
  - `template.cpp`：快照生成 / 套用
  - `config.cpp`：活动 / 系统配置（key 白名单 + 类型化）
  - `role.cpp`：角色列表 + `user_role` 授权 + `audit_log` 写入与查询
- **迁移 `0002_seed_roles.sql`**：幂等 INSERT 三个角色。
- **host**：`server.js` 支持路径参数注入 `ctx.params`；新增 `/api/admin/*` 路由（JWT 鉴权 + 透传 `uid`）；公开 `/api/activities` 读路由。
- **测试**：native 单测（状态转移表 / 软删 / 权限矩阵 / 分组树递归 / 冻结字段）；host smoke（HTTP 全链路：建活动→绑定分组→配表单字段→套模板→授权→审计查询）。

## 六、决策记录

| 项 | 决策 |
|---|---|
| 状态流转 | `activity.update` 内校验转移表，不设独立 op（报名端另按时间判断） |
| 活动删除 | 仅草稿（status=0）可软删，已发布 409 |
| 字段修改 | 冻结 `field_key` / `field_type`；进行中 `options` 仅追加 |
| 权限判定位置 | wasm 内完成（uid 入参），宿主只做 JWT 校验，与 M1 一致 |
| 角色种子 | 迁移 0002 写入（role_id 1/2/3），不改 0001（已发布） |
