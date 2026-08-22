-- 0005_notification_attempt_count.sql — 邮件队列重试次数上限（后端全链路审计 Issue 4）
-- 背景：host/task/notify.js flushMailQueue 对发送失败的通知置 send_status=0 无限重试
--（60s 一次、无退避上限），SMTP 永久失败（5xx）会持续打击邮件服务。
-- 新增 attempt_count 列：每次发送失败 +1，达到上限（notify.js MAX_MAIL_ATTEMPTS=10）
-- 置 send_status=2（永久失败）终止重试。默认 0，向后兼容旧数据。

ALTER TABLE notification ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
