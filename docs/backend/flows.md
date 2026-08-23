# 典型流程

> [返回后端导航](index.md)

1. **配置**：创建活动（配置 `activity_type`、`need_review`、`allow_modify` 等，按形式登记场地/参会链接/签到方式）→ 添加表单/字段（默认值、校验、联动、可见性等）→ 关联分组 → 配置角色授权 → 可选写入活动/系统配置。
2. **注册/登录**：注册写 `account` 与 `user`；登录按 `username` 校验密码，失败计数达上限锁定至 `lock_until`，忘记密码经 `user.email` 发送 `reset_token` 重置（M1 联调阶段 token 由接口直接返回 `data.token`，SMTP 接入后改为邮件发送，见 [auth.md](auth.md)）。
3. **报名**：校验 `(activity_id, uid)` 唯一 → 预填（基础资料取 `user`，其余按 `field_key` 取 `user_common_info`）→ 分步填写（草稿自动保存）写 `registration_data` → 提交生成 `receipt_no`，按 `need_review` 置待审核或直接通过。
4. **审核**：审核员按角色与分组范围处理待审核报名 → 通过 / 驳回（填 `review_remark`）→ 结果通知用户；操作写入 `audit_log`。
5. **名额/候补**：报名条件更新防超卖；满员置候补（`queue_no`），有名额自动递补（`need_review=1` 置待审核，否则直接通过）并通知。
6. **导出/统计**：按配置层字段定义拼表头导出；按分组/字段统计报名数据。
