# 索引设计

> [返回后端导航](index.md)

`account(username 唯一)`、`user_common_info(uid)`、`activity_config(activity_id)`、`group(parent_id)`、`activity_group(group_id / activity_id)`、`form(activity_id)`、`form_field(form_id)`、`registration(activity_id / uid)`、`registration_data(registration_id)`、`notification(uid)`、`subscribe(uid)`、`audit_log(operator_uid)`、`registration(activity_id, status, queue_no)`（候补递补）、`registration(activity_id, status)`（审核/列表）、`notification(uid, is_read)`（未读列表）、`subscribe(activity_id)`（按活动查订阅）。
