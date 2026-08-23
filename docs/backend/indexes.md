# 索引设计

> [返回后端导航](index.md)

索引随迁移版本演进，以下为 0001 迁移基线；增量见 0003 / 0004 / 0006 迁移。

`account(username 唯一)`、`user_common_info(uid)`、`activity_config(activity_id)`、`group(parent_id)`、`activity_group(group_id / activity_id)`、`form(activity_id)`、`form_field(form_id)`、`registration(activity_id / uid)`、`registration_data(registration_id)`、`notification(uid)`、`subscribe(uid)`、`audit_log(operator_uid)`、`registration(activity_id, status, queue_no)`（候补递补）、`registration(activity_id, status)`（审核/列表）、`notification(uid, is_read)`（未读列表）、`subscribe(activity_id)`（按活动查订阅）、`notification(activity_id)`（0003 迁移新增，按活动检索通知）、`registration_data(field_id)`（0004 迁移新增，按字段统计报名数据）、`user_pref(uid)`（0006 迁移新增，用户界面偏好）。
