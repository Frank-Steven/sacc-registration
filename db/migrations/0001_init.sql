-- 0001_init.sql — SACC 报名系统初始表结构
-- 约定：时间均为 Unix 秒（INTEGER）；业务删除走软删（is_deleted=1）
-- 覆盖：配置层（activity/form/group/config/template）、用户层（account/user/role/notification）、数据层（registration）

-- ============ 用户层 ============

CREATE TABLE IF NOT EXISTS account (
  uid             INTEGER PRIMARY KEY,
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  salt            TEXT    NOT NULL,
  status          INTEGER NOT NULL DEFAULT 0,  -- 0 正常 / 1 禁用
  login_fail_count INTEGER NOT NULL DEFAULT 0, -- 连续失败次数，达上限锁定
  lock_until      INTEGER,                     -- 锁定截止（NULL 未锁定）
  reset_token     TEXT,
  reset_expire    INTEGER,
  last_login_at   INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "user" (
  uid        INTEGER PRIMARY KEY REFERENCES account(uid),
  name       TEXT NOT NULL DEFAULT '',
  student_id TEXT NOT NULL DEFAULT '',
  college    TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',         -- 密码重置 / 邮件通知渠道
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_common_info (
  info_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         INTEGER NOT NULL REFERENCES "user"(uid),
  field_key   TEXT    NOT NULL,
  field_label TEXT    NOT NULL DEFAULT '',
  field_value TEXT    NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL,
  UNIQUE (uid, field_key)
);
CREATE INDEX IF NOT EXISTS idx_user_common_info_uid ON user_common_info (uid);

CREATE TABLE IF NOT EXISTS role (
  role_id     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,            -- 超级管理员 / 活动管理员 / 审核员
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_role (
  uid      INTEGER NOT NULL REFERENCES "user"(uid),
  role_id  INTEGER NOT NULL REFERENCES role(role_id),
  group_id INTEGER REFERENCES "group"(group_id), -- 管理范围（NULL 全部，非 NULL 含子分组）
  PRIMARY KEY (uid, role_id)
);

CREATE TABLE IF NOT EXISTS notification (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             INTEGER NOT NULL REFERENCES "user"(uid),
  type            INTEGER NOT NULL,            -- 0 报名成功 / 1 审核结果 / 2 活动提醒
  title           TEXT    NOT NULL DEFAULT '',
  content         TEXT    NOT NULL DEFAULT '',
  is_read         INTEGER NOT NULL DEFAULT 0,
  channel         INTEGER NOT NULL DEFAULT 0,  -- 0 站内信 / 1 邮件
  send_status     INTEGER NOT NULL DEFAULT 0,  -- 0 待发送 / 1 已发送 / 2 失败（宿主 SMTP 发送并重试）
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_uid       ON notification (uid);
CREATE INDEX IF NOT EXISTS idx_notification_uid_read  ON notification (uid, is_read);

CREATE TABLE IF NOT EXISTS subscribe (
  subscribe_id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          INTEGER NOT NULL REFERENCES "user"(uid),
  activity_id  INTEGER NOT NULL REFERENCES activity(activity_id),
  created_at   INTEGER NOT NULL,
  UNIQUE (uid, activity_id)
);
CREATE INDEX IF NOT EXISTS idx_subscribe_uid      ON subscribe (uid);
CREATE INDEX IF NOT EXISTS idx_subscribe_activity ON subscribe (activity_id);

CREATE TABLE IF NOT EXISTS user_notify_pref (
  pref_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         INTEGER NOT NULL REFERENCES "user"(uid),
  notify_type INTEGER NOT NULL,
  channel     INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (uid, notify_type)
);

-- ============ 配置层 ============

CREATE TABLE IF NOT EXISTS activity (
  activity_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  activity_type INTEGER NOT NULL DEFAULT 0,    -- 0 线下 / 1 线上 / 2 混合
  start_time    INTEGER NOT NULL DEFAULT 0,    -- 报名起止
  end_time      INTEGER NOT NULL DEFAULT 0,
  max_slots     INTEGER NOT NULL DEFAULT 0,    -- 名额上限（0 不限）
  status        INTEGER NOT NULL DEFAULT 0,    -- 0 草稿 / 1 进行中 / 2 已截止 / 3 已结束
  need_review   INTEGER NOT NULL DEFAULT 0,    -- 0 否 / 1 是
  allow_modify  INTEGER NOT NULL DEFAULT 0,    -- 报名后截止前可修改
  is_deleted    INTEGER NOT NULL DEFAULT 0,    -- 软删除
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS form (
  form_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id INTEGER NOT NULL REFERENCES activity(activity_id),
  name        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,      -- 填写步骤顺序
  is_required INTEGER NOT NULL DEFAULT 0,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_activity ON form (activity_id);

CREATE TABLE IF NOT EXISTS form_field (
  field_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id       INTEGER NOT NULL REFERENCES form(form_id),
  field_key     TEXT    NOT NULL,              -- 不可变；只追加、软删
  field_label   TEXT    NOT NULL DEFAULT '',
  field_type    INTEGER NOT NULL DEFAULT 0,    -- 0 文本 / 1 数字 / 2 单选 / 3 多选 / 4 日期 / 5 文件
  is_required   INTEGER NOT NULL DEFAULT 0,
  options       TEXT    NOT NULL DEFAULT '',   -- 选项 JSON（单选/多选）
  default_value TEXT    NOT NULL DEFAULT '',
  placeholder   TEXT    NOT NULL DEFAULT '',
  validation    TEXT    NOT NULL DEFAULT '',   -- 校验规则 JSON
  is_visible    INTEGER NOT NULL DEFAULT 1,
  is_editable   INTEGER NOT NULL DEFAULT 1,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  remark        TEXT    NOT NULL DEFAULT '',   -- 文件类白名单等
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_field_form ON form_field (form_id);

CREATE TABLE IF NOT EXISTS "group" (
  group_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES "group"(group_id), -- NULL 为顶级
  name        TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_parent ON "group" (parent_id);

CREATE TABLE IF NOT EXISTS activity_group (
  activity_id INTEGER NOT NULL REFERENCES activity(activity_id),
  group_id    INTEGER NOT NULL REFERENCES "group"(group_id),
  PRIMARY KEY (activity_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_group_group ON activity_group (group_id);

CREATE TABLE IF NOT EXISTS activity_config (
  config_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id  INTEGER NOT NULL REFERENCES activity(activity_id),
  config_key   TEXT    NOT NULL,               -- venue_name / meeting_link / checkin_mode 等
  config_value TEXT    NOT NULL DEFAULT '',
  config_type  INTEGER NOT NULL DEFAULT 2,     -- 0 布尔 / 1 数字 / 2 文本 / 3 JSON
  remark       TEXT    NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL,
  UNIQUE (activity_id, config_key)
);
CREATE INDEX IF NOT EXISTS idx_activity_config_activity ON activity_config (activity_id);

CREATE TABLE IF NOT EXISTS system_config (
  config_key   TEXT PRIMARY KEY,               -- site_name / max_upload_size 等
  config_value TEXT NOT NULL DEFAULT '',
  config_type  INTEGER NOT NULL DEFAULT 2,     -- 0 布尔 / 1 数字 / 2 文本 / 3 JSON
  description  TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS form_template (
  template_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL DEFAULT '',        -- 字段定义快照（form_field 字段集 JSON）
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  log_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_uid INTEGER REFERENCES "user"(uid),
  action       TEXT NOT NULL,                  -- 如 update_activity
  target       TEXT NOT NULL DEFAULT '',
  detail       TEXT NOT NULL DEFAULT '',       -- 变更内容 JSON
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_operator ON audit_log (operator_uid);

-- ============ 数据层 ============

CREATE TABLE IF NOT EXISTS registration (
  registration_id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id     INTEGER NOT NULL REFERENCES activity(activity_id),
  uid             INTEGER NOT NULL REFERENCES "user"(uid),
  receipt_no      TEXT    NOT NULL DEFAULT '', -- 凭证编号（提交时生成）
  current_step    INTEGER NOT NULL DEFAULT 0,  -- 当前表单步骤
  queue_no        INTEGER,                     -- 候补序号（仅候补状态）
  status          INTEGER NOT NULL DEFAULT 0,  -- 0 填写中 / 1 待审核 / 2 已通过 / 3 未通过 / 4 已取消 / 5 候补
  reviewer        INTEGER REFERENCES "user"(uid),
  review_time     INTEGER,
  review_remark   TEXT    NOT NULL DEFAULT '',
  checkin_time    INTEGER,                     -- 签到时间（NULL 未签到）
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (activity_id, uid)                    -- 同一用户不可重复报名
);
CREATE INDEX IF NOT EXISTS idx_registration_activity_uid    ON registration (activity_id, uid);
CREATE INDEX IF NOT EXISTS idx_registration_activity_status ON registration (activity_id, status);
CREATE INDEX IF NOT EXISTS idx_registration_queue          ON registration (activity_id, status, queue_no);

CREATE TABLE IF NOT EXISTS registration_data (
  data_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registration(registration_id),
  field_id        INTEGER NOT NULL REFERENCES form_field(field_id),
  field_value     TEXT    NOT NULL DEFAULT '', -- 数字/日期固定格式、多选 JSON 数组、文件存路径
  UNIQUE (registration_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_registration_data_reg ON registration_data (registration_id);
