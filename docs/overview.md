# 系统总体设计

> [返回总入口](README.md) · 后端 [index.md](backend/index.md) · 前端 [index.md](frontend/index.md)

## 一、三层结构

| 层次 | 职责 | 包含表 |
|---|---|---|
| 配置层 | 活动、分组、表单与字段定义，系统与活动配置，审计日志，**活动驱动** | `activity` `group` `activity_group` `form` `form_field` `form_template` `activity_config` `system_config` `audit_log` |
| 用户层 | 登录账号、权限角色、身份资料、常用信息、通知与订阅，**跨活动复用** | `account` `user` `user_common_info` `role` `user_role` `notification` `subscribe` `user_notify_pref` `user_pref` |
| 数据层 | 报名记录与字段明细，**按活动生成** | `registration` `registration_data` |

## 二、跨层关联

- 配置 → 数据：`activity` 一对多 `registration`；`registration` 多对多 `form_field`（经 `registration_data`）
- 配置 → 用户：`group` 多对多 `user`（`user_role` 限定管理范围）；`audit_log` 经 `operator_uid` 关联 `user`
- 用户 → 数据：`user` 一对多 `registration`（报名人 / 审核人）
- 用户 → 配置：`user` 一对多 `activity_config`（`updated_by`）

## 三、表设计约定

- 主键 `INTEGER PK` 自增，关联键加 `→ 表名` 标注，外键均为整数
- 时间一律 `INTEGER` Unix 秒
- 文本一律 UTF-8
- 删除策略：配置层实体（`activity` / `form` / `group` / `form_field`）软删（`is_deleted`）；用户层明细（订阅 `subscribe` / 常用信息 `user_common_info` / 偏好 `user_notify_pref`）为物理删除；报名取消置 `status=4`
