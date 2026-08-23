#include "config/config.h"

#include <cerrno>
#include <cstdlib>
#include <map>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// config_type：0 布尔 / 1 数字 / 2 文本 / 3 JSON
struct ConfigKey {
  int type;
  std::string remark;
};

// key 常量白名单（config.md 3.5）；未登记 key 拒绝
const std::map<std::string, ConfigKey>& activityKeys() {
  static const std::map<std::string, ConfigKey> m = {
      {"venue_name", {2, "线下场地名称"}},
      {"venue_address", {2, "线下场地地址"}},
      {"meeting_link", {2, "线上会议链接"}},
      {"meeting_pwd", {2, "线上会议密码"}},
      {"checkin_mode", {1, "签到方式：0 现场 / 1 线上自助 / 2 线上动态码"}},
      {"notify_channel", {1, "通知渠道：0 站内信 / 1 邮件"}},
  };
  return m;
}

const std::map<std::string, ConfigKey>& systemKeys() {
  static const std::map<std::string, ConfigKey> m = {
      {"site_name", {2, "站点名称"}},
      {"max_upload_size", {1, "上传大小上限（MB）"}},
      {"checkin_secret", {2, "签到动态码密钥（checkin_mode=2 时使用，仅超管可读写）"}},
      // 邮件服务（M8）：官方邮箱发送验证码与通知；smtp_pass 掩码展示
      {"mail_from", {2, "官方发件邮箱（用于发送验证码与通知）"}},
      {"smtp_host", {2, "SMTP 服务器地址"}},
      {"smtp_port", {1, "SMTP 端口（465 隐式 SSL / 587 STARTTLS）"}},
      {"smtp_user", {2, "SMTP 登录账号"}},
      {"smtp_pass", {2, "SMTP 登录密码（掩码展示，留空不修改）"}},
  };
  return m;
}

// 按类型归一化值；不合法返回 false 并填充错误消息
bool normalizeValue(int type, const nlohmann::json& raw, std::string& out_value,
                    std::string& out_err) {
  switch (type) {
    case 0: {  // 布尔
      if (raw.is_boolean()) {
        out_value = raw.get<bool>() ? "1" : "0";
        return true;
      }
      if (raw.is_number_integer()) {
        const int v = raw.get<int>();
        if (v == 0 || v == 1) {
          out_value = std::to_string(v);
          return true;
        }
      }
      if (raw.is_string()) {
        const std::string s = raw.get<std::string>();
        if (s == "0" || s == "1" || s == "true" || s == "false") {
          out_value = (s == "1" || s == "true") ? "1" : "0";
          return true;
        }
      }
      out_err = "布尔值须为 true/false 或 0/1";
      return false;
    }
    case 1: {  // 数字
      std::int64_t v = 0;
      if (raw.is_number_integer()) {
        v = raw.get<std::int64_t>();
      } else if (raw.is_number_unsigned()) {
        v = static_cast<std::int64_t>(raw.get<std::uint64_t>());
      } else if (raw.is_string()) {
        const std::string s = raw.get<std::string>();
        errno = 0;
        const char* p = s.c_str();
        char* end = nullptr;
        const long long lv = std::strtoll(p, &end, 10);
        if (errno == ERANGE || end == p || *end != '\0') {  // 审查 Issue 7：溢出/非纯数字拒
          out_err = "数字值格式不正确";
          return false;
        }
        v = static_cast<std::int64_t>(lv);
      } else {
        out_err = "数字值格式不正确";
        return false;
      }
      out_value = std::to_string(v);
      return true;
    }
    case 2: {  // 文本
      if (!raw.is_string()) {
        out_err = "文本值须为字符串";
        return false;
      }
      out_value = raw.get<std::string>();
      return true;
    }
    case 3: {  // JSON
      if (raw.is_string()) {
        nlohmann::json parsed;
        if (!json_parse_lenient(raw.get<std::string>(), parsed)) {
          out_err = "JSON 值格式不正确";
          return false;
        }
        out_value = parsed.dump();
        return true;
      }
      out_value = raw.dump();
      return true;
    }
  }
  out_err = "未知配置类型";
  return false;
}

// 单个 key 的额外取值约束（checkin_mode 0/1/2；notify_channel 仅 0/1）
const nlohmann::json* extraValidate(const std::string& key, const std::string& value) {
  if (key == "checkin_mode") {
    if (value != "0" && value != "1" && value != "2") {
      static const nlohmann::json err = cfg_err(kValidation, "该配置仅接受 0、1 或 2");
      return &err;
    }
  } else if (key == "notify_channel" && value != "0" && value != "1") {
    static const nlohmann::json err = cfg_err(kValidation, "该配置仅接受 0 或 1");
    return &err;
  }
  if (key == "max_upload_size") {
    errno = 0;
    const char* p = value.c_str();
    char* end = nullptr;
    const long long v = std::strtoll(p, &end, 10);
    if (errno == ERANGE || end == p || *end != '\0') {  // 审查 Issue 7：溢出/非纯数字拒
      static const nlohmann::json err = cfg_err(kValidation, "max_upload_size 须为数字");
      return &err;
    }
    if (v < 0) {
      static const nlohmann::json err = cfg_err(kValidation, "max_upload_size 不得为负");
      return &err;
    }
  }
  return nullptr;
}

// 归一化并校验一条 {key, value}（items 批量入口）；返回空对象表示成功
nlohmann::json normalizeItem(const ConfigKey& spec, const std::string& key,
                             const nlohmann::json& value, std::string& out_value) {
  std::string err;
  if (!normalizeValue(spec.type, value, out_value, err)) {
    return cfg_err(kValidation, key + ": " + err);
  }
  if (const nlohmann::json* e = extraValidate(key, out_value)) return *e;
  return nlohmann::json();
}

} // namespace

nlohmann::json activity_config_set(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限操作该活动");

  // 支持单条 {key,value} 或批量 {items:[{key,value},...]}
  nlohmann::json items;
  if (args.contains("items") && args["items"].is_array()) {
    items = args["items"];
  } else if (args.contains("key")) {
    items = nlohmann::json::array({{{"key", cfg_str(args, "key")}, {"value", args.contains("value") ? args["value"] : nlohmann::json("")}}});
  }
  if (items.empty()) return cfg_ok({{"ok", true}});

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  for (const auto& item : items) {
    const std::string key = item.value("key", "");
    const auto it = activityKeys().find(key);
    if (it == activityKeys().end()) {
      db.rollback();
      return cfg_err(kValidation, "未登记的配置 key: " + key);
    }
    std::string value;
    const nlohmann::json e = normalizeItem(it->second, key,
                                           item.contains("value") ? item["value"]
                                                                  : nlohmann::json(""),
                                           value);
    if (!e.empty()) {
      db.rollback();
      return e;
    }
    if (db.execParams(
            "INSERT INTO activity_config (activity_id, config_key, config_value, config_type, "
            "remark, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(activity_id, config_key) DO UPDATE SET config_value = excluded.config_value, "
            "config_type = excluded.config_type, remark = excluded.remark, "
            "updated_at = excluded.updated_at;",
            nlohmann::json::array({activity_id, key, value, it->second.type, it->second.remark,
                                   now_ts()})) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "upsert failed: " + db.lastError());
    }
  }
  if (db.commit() != SQLITE_OK) return cfg_err(kDbError, "commit failed");

  audit_log(db, uid, "set_activity_config", "activity:" + std::to_string(activity_id),
            {{"count", items.size()}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json activity_config_get(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (!can_read_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限查看配置");
  const std::string key = cfg_str(args, "key");
  if (activityKeys().find(key) == activityKeys().end()) {
    return cfg_err(kValidation, "未登记的配置 key: " + key);
  }
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_value, config_type, remark FROM activity_config "
               "WHERE activity_id = ? AND config_key = ? LIMIT 1;",
               nlohmann::json::array({activity_id, key}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (rows.empty()) return cfg_err(kNotFound, "该配置未设置");
  return cfg_ok({{"key", key}, {"value", rows[0].value("config_value", "")},
                 {"type", rows[0].value("config_type", 0)}, {"remark", rows[0].value("remark", "")}});
}

nlohmann::json activity_config_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (!can_read_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限查看配置");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_key AS key, config_value AS value, config_type AS type, remark "
               "FROM activity_config WHERE activity_id = ? ORDER BY config_key;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json system_config_set(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可修改系统配置");
  nlohmann::json items;
  if (args.contains("items") && args["items"].is_array()) {
    items = args["items"];
  } else if (args.contains("key")) {
    items = nlohmann::json::array({{{"key", cfg_str(args, "key")}, {"value", args.contains("value") ? args["value"] : nlohmann::json("")}}});
  }
  if (items.empty()) return cfg_ok({{"ok", true}});

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  for (const auto& item : items) {
    const std::string key = item.value("key", "");
    const auto it = systemKeys().find(key);
    if (it == systemKeys().end()) {
      db.rollback();
      return cfg_err(kValidation, "未登记的配置 key: " + key);
    }
    std::string value;
    const nlohmann::json e = normalizeItem(it->second, key,
                                           item.contains("value") ? item["value"]
                                                                  : nlohmann::json(""),
                                           value);
    if (!e.empty()) {
      db.rollback();
      return e;
    }
    if (db.execParams(
            "INSERT INTO system_config (config_key, config_value, config_type, description, "
            "updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(config_key) DO UPDATE SET "
            "config_value = excluded.config_value, config_type = excluded.config_type, "
            "description = excluded.description, updated_at = excluded.updated_at;",
            nlohmann::json::array({key, value, it->second.type, it->second.remark, now_ts()})) !=
        SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "upsert failed: " + db.lastError());
    }
  }
  if (db.commit() != SQLITE_OK) return cfg_err(kDbError, "commit failed");

  audit_log(db, uid, "set_system_config", "system", {{"count", items.size()}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json system_config_get(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可查看系统配置");
  const std::string key = cfg_str(args, "key");
  if (systemKeys().find(key) == systemKeys().end()) {
    return cfg_err(kValidation, "未登记的配置 key: " + key);
  }
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_value, config_type, description FROM system_config "
               "WHERE config_key = ? LIMIT 1;",
               nlohmann::json::array({key}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (rows.empty()) return cfg_err(kNotFound, "该配置未设置");
  return cfg_ok({{"key", key}, {"value", rows[0].value("config_value", "")},
                 {"type", rows[0].value("config_type", 0)},
                 {"description", rows[0].value("description", "")}});
}

nlohmann::json system_config_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可查看系统配置");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_key AS key, config_value AS value, config_type AS type, description "
               "FROM system_config ORDER BY config_key;",
               nullptr, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

} // namespace sacc
