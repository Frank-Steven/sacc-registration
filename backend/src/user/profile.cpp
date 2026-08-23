#include "user/profile.h"

#include <cctype>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// 邮箱宽松校验（与 auth.cpp 一致：非空、含 @ 与点、长度受限）
bool validEmail(const std::string& e) {
  if (e.empty() || e.size() > 254) return false;
  const std::size_t at = e.find('@');
  if (at == std::string::npos || at == 0 || at + 1 >= e.size()) return false;
  const std::size_t dot = e.find('.', at);
  return dot != std::string::npos && dot + 1 < e.size();
}

// 常用信息 / 偏好字段 key：1~50 位小写字母数字下划线（前端表单预填 key 契约）
bool validKey(const std::string& k) {
  if (k.empty() || k.size() > 50) return false;
  for (const char c : k) {
    if (!(std::islower(static_cast<unsigned char>(c)) || std::isdigit(static_cast<unsigned char>(c)) ||
          c == '_')) {
      return false;
    }
  }
  return true;
}

} // namespace

nlohmann::json user_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");

  // 组装可更新字段（空值允许：清空某字段）
  std::string sql = "UPDATE \"user\" SET ";
  nlohmann::json params = nlohmann::json::array();
  if (args.contains("name")) {
    const std::string v = cfg_str(args, "name");
    if (v.size() > 50) return cfg_err(kValidation, "姓名长度不能超过 50");
    sql += "name = ?, ";
    params.push_back(v);
  }
  if (args.contains("student_id")) {
    const std::string v = cfg_str(args, "student_id");
    if (v.size() > 32) return cfg_err(kValidation, "学号长度不能超过 32");
    sql += "student_id = ?, ";
    params.push_back(v);
  }
  if (args.contains("college")) {
    const std::string v = cfg_str(args, "college");
    if (v.size() > 100) return cfg_err(kValidation, "院系长度不能超过 100");
    sql += "college = ?, ";
    params.push_back(v);
  }
  if (args.contains("phone")) {
    const std::string v = cfg_str(args, "phone");
    if (v.size() > 20) return cfg_err(kValidation, "手机号长度不能超过 20");
    sql += "phone = ?, ";
    params.push_back(v);
  }
  if (args.contains("email")) {
    const std::string v = cfg_str(args, "email");
    if (!v.empty() && !validEmail(v)) return cfg_err(kValidation, "邮箱格式不正确");
    sql += "email = ?, ";
    params.push_back(v);
  }
  if (args.contains("lang")) {
    // M9：界面语言偏好保留到用户数据（zh / en）
    const std::string v = cfg_str(args, "lang");
    if (v != "zh" && v != "en") return cfg_err(kValidation, "lang 须为 zh 或 en");
    sql += "lang = ?, ";
    params.push_back(v);
  }
  if (args.contains("avatar")) {
    // M9：头像 base64 data URL（空串=清除）；限制体积避免单行过大
    const std::string v = cfg_str(args, "avatar");
    const bool isDataUrl = v.rfind("data:image/", 0) == 0 && v.find(";base64,") != std::string::npos;
    if (!v.empty() && !isDataUrl) return cfg_err(kValidation, "avatar 须为 data:image/*;base64 格式");
    if (v.size() > 400000) return cfg_err(kValidation, "头像文件过大（超过约 300KB）");
    sql += "avatar = ?, ";
    params.push_back(v);
  }
  if (params.empty()) return cfg_ok({{"ok", true}});  // 无可更新字段
  sql.resize(sql.size() - 2);
  sql += " WHERE uid = ?;";
  params.push_back(uid);
  if (db.execParams(sql, params) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_common_info_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT field_key, field_label, field_value, updated_at FROM user_common_info "
               "WHERE uid = ? ORDER BY field_key;",
               nlohmann::json::array({uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json user_common_info_save(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::string field_key = cfg_str(args, "field_key");
  if (!validKey(field_key)) return cfg_err(kValidation, "field_key 须为 1~50 位小写字母数字下划线");
  const std::string field_label = cfg_str(args, "field_label");
  if (field_label.size() > 50) return cfg_err(kValidation, "field_label 长度不能超过 50");
  const std::string field_value = cfg_str(args, "field_value");
  if (field_value.size() > 1000) return cfg_err(kValidation, "field_value 长度不能超过 1000");
  if (db.execParams("INSERT INTO user_common_info (uid, field_key, field_label, field_value, "
                    "updated_at) VALUES (?, ?, ?, ?, ?) "
                    "ON CONFLICT(uid, field_key) DO UPDATE SET field_label = excluded.field_label, "
                    "field_value = excluded.field_value, updated_at = excluded.updated_at;",
                    nlohmann::json::array({uid, field_key, field_label, field_value, now_ts()})) !=
      SQLITE_OK) {
    return cfg_err(kDbError, "upsert failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_common_info_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::string field_key = cfg_str(args, "field_key");
  if (!validKey(field_key)) return cfg_err(kValidation, "field_key 不合法");
  const int rc = db.execParams("DELETE FROM user_common_info WHERE uid = ? AND field_key = ?;",
                               nlohmann::json::array({uid, field_key}));
  if (rc != SQLITE_OK) return cfg_err(kDbError, "delete failed: " + db.lastError());
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "常用信息不存在");
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_notify_pref_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT notify_type, channel, updated_at FROM user_notify_pref "
               "WHERE uid = ? ORDER BY notify_type;",
               nlohmann::json::array({uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json user_notify_pref_set(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t notify_type = cfg_int(args, "notify_type", -1);
  // 通知类型（notification.md / registration.md）：0 报名成功 / 1 审核结果 / 2 活动提醒 / 3 递补
  if (notify_type < 0 || notify_type > 3) return cfg_err(kValidation, "notify_type 须为 0~3");
  const std::int64_t channel = cfg_int(args, "channel", -1);
  // M8：渠道 bitmask（1=站内信 / 2=邮箱 / 3=两者）
  if (channel < 1 || channel > 3) return cfg_err(kValidation, "channel 须为 1（站内信）/ 2（邮箱）/ 3（两者）");
  if (db.execParams("INSERT INTO user_notify_pref (uid, notify_type, channel, updated_at) "
                    "VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(uid, notify_type) DO UPDATE SET channel = excluded.channel, "
                    "updated_at = excluded.updated_at;",
                    nlohmann::json::array({uid, notify_type, channel, now_ts()})) != SQLITE_OK) {
    return cfg_err(kDbError, "upsert failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_notify_pref_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t notify_type = cfg_int(args, "notify_type", -1);
  if (notify_type < 0 || notify_type > 3) return cfg_err(kValidation, "notify_type 须为 0~3");
  const int rc = db.execParams("DELETE FROM user_notify_pref WHERE uid = ? AND notify_type = ?;",
                               nlohmann::json::array({uid, notify_type}));
  if (rc != SQLITE_OK) return cfg_err(kDbError, "delete failed: " + db.lastError());
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "通知偏好不存在");
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_pref_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT pref_key, pref_value, updated_at FROM user_pref "
               "WHERE uid = ? ORDER BY pref_key;",
               nlohmann::json::array({uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json user_pref_set(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::string pref_key = cfg_str(args, "pref_key");
  if (!validKey(pref_key)) return cfg_err(kValidation, "pref_key 须为 1~50 位小写字母数字下划线");
  const std::string pref_value = cfg_str(args, "pref_value");
  if (pref_value.size() > 64) return cfg_err(kValidation, "pref_value 长度不能超过 64");
  if (db.execParams("INSERT INTO user_pref (uid, pref_key, pref_value, updated_at) "
                    "VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(uid, pref_key) DO UPDATE SET pref_value = excluded.pref_value, "
                    "updated_at = excluded.updated_at;",
                    nlohmann::json::array({uid, pref_key, pref_value, now_ts()})) != SQLITE_OK) {
    return cfg_err(kDbError, "upsert failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

} // namespace sacc
