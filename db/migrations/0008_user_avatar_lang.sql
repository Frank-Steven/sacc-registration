-- 0008_user_avatar_lang.sql — 用户头像与界面语言偏好入 user 表（M9）
-- avatar：base64 data URL（data:image/png|jpeg|webp;base64,...），空串未设置
-- lang：zh / en；语言偏好从 user_pref.locale 老值迁移，theme 仍留在 user_pref
ALTER TABLE "user" ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE "user" ADD COLUMN lang TEXT NOT NULL DEFAULT 'zh';

UPDATE "user" SET lang = (
  SELECT pref_value FROM user_pref
  WHERE user_pref.uid = "user".uid AND user_pref.pref_key = 'locale' AND pref_value IN ('zh', 'en')
) WHERE EXISTS (
  SELECT 1 FROM user_pref
  WHERE user_pref.uid = "user".uid AND user_pref.pref_key = 'locale' AND pref_value IN ('zh', 'en')
);
