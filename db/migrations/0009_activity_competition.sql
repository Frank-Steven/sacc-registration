-- 0009_activity_competition.sql — 活动表新增「比赛时间」（区别于报名窗口 start/end_time）
-- 比赛时间可为空（0 表示未设置）；范围用 start/end 表达

ALTER TABLE activity ADD COLUMN competition_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity ADD COLUMN competition_end   INTEGER NOT NULL DEFAULT 0;
