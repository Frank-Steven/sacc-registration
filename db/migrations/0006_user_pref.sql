-- 用户前端界面偏好（theme / locale）：服务端持久化，登录后跨设备同步。
-- (uid, pref_key) 唯一；pref_key 由前端约定（theme|locale），pref_value 为字符串。
CREATE TABLE IF NOT EXISTS user_pref (
  uid INTEGER NOT NULL,
  pref_key TEXT NOT NULL,
  pref_value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, pref_key)
);
CREATE INDEX IF NOT EXISTS idx_user_pref_uid ON user_pref(uid);
