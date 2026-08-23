-- 通知渠道偏好改为 bitmask（M8）：user_notify_pref.channel 支持同时选择站内信与邮箱。
-- 新语义：1=站内信 / 2=邮箱 / 3=两者（原 0=站内信 / 1=邮件）。
-- 通知生成按 bitmask 展开为两条记录（站内直写 + 邮件入 SMTP 队列），通知中心仅展示站内信（channel=0）。
UPDATE user_notify_pref SET channel = CASE channel WHEN 0 THEN 1 WHEN 1 THEN 2 ELSE channel END;
