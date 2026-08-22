-- 0003_notification_activity_id.sql — 通知关联活动（registration.md 七）
-- 背景：M3 通知写入时 activity_id 未落库，导致通知无法关联活动、
-- 提醒幂等只能按 content 判重（活动同名会误判）。新增可空列，向后兼容旧数据。

ALTER TABLE notification ADD COLUMN activity_id INTEGER REFERENCES activity(activity_id);

CREATE INDEX IF NOT EXISTS idx_notification_activity ON notification (activity_id);
