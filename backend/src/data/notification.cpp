#include "data/notification.h"

#include <algorithm>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// 通知渠道 bitmask（M8）：1=站内信 / 2=邮箱 / 3=两者。
// 用户偏好（user_notify_pref）优先；未配置按活动 notify_channel；默认站内信。
// 含邮箱位但用户无邮箱地址 → 去掉邮箱位（降级站内信）。
int channels_for(Db& db, std::int64_t uid, int type, std::int64_t activity_id) {
  int channels = 1;  // 默认站内信
  nlohmann::json rows;
  std::string qerr;
  bool hasPref = false;
  if (db.query("SELECT channel FROM user_notify_pref WHERE uid = ? AND notify_type = ? LIMIT 1;",
               nlohmann::json::array({uid, type}), rows, qerr) == SQLITE_OK && !rows.empty()) {
    hasPref = true;
    channels = rows[0].value("channel", 1);
    if (channels < 1 || channels > 3) channels = 1;  // 防御：非法值回落站内信
  } else if (activity_id > 0 &&
             db.query("SELECT config_value FROM activity_config "
                      "WHERE activity_id = ? AND config_key = 'notify_channel' LIMIT 1;",
                      nlohmann::json::array({activity_id}), rows, qerr) == SQLITE_OK &&
             !rows.empty()) {
    if (rows[0].value("config_value", "0") == "1") channels |= 2;  // 活动默认含邮件
  }
  // 含邮箱位但用户无邮箱 → 降级（保留站内信）
  if ((channels & 2) != 0) {
    rows.clear();
    if (db.query("SELECT 1 FROM \"user\" WHERE uid = ? AND email != '' LIMIT 1;",
                 nlohmann::json::array({uid}), rows, qerr) == SQLITE_OK && rows.empty()) {
      channels &= ~2;
      if (channels == 0) channels = 1;
    }
  }
  (void)hasPref;
  return channels;
}

} // namespace

void notify(Db& db, std::int64_t uid, int type, const std::string& title,
            const std::string& content, std::int64_t activity_id) {
  if (uid <= 0) return;
  const int channels = channels_for(db, uid, type, activity_id);
  const std::int64_t now = now_ts();
  // 站内信直写即达（channel=0, send_status=1）；邮件入 SMTP 队列（channel=1, send_status=0）
  const auto act = activity_id > 0 ? nlohmann::json(activity_id) : nlohmann::json(nullptr);
  if ((channels & 1) != 0) {
    db.execParams("INSERT INTO notification (uid, type, title, content, is_read, channel, "
                  "send_status, activity_id, created_at) "
                  "VALUES (?, ?, ?, ?, 0, 0, 1, ?, ?);",
                  nlohmann::json::array({uid, type, title, content, act, now}));
  }
  if ((channels & 2) != 0) {
    db.execParams("INSERT INTO notification (uid, type, title, content, is_read, channel, "
                  "send_status, activity_id, created_at) "
                  "VALUES (?, ?, ?, ?, 0, 1, 0, ?, ?);",
                  nlohmann::json::array({uid, type, title, content, act, now}));
  }
}

nlohmann::json notification_mine(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t page = std::max(cfg_int(args, "page", 1), std::int64_t{1});
  const std::int64_t page_size =
      std::max(std::int64_t{1}, std::min(cfg_int(args, "page_size", 20), std::int64_t{100}));
  const bool unread_only = cfg_bool(args, "unread_only", false);

  // 通知中心仅展示站内信（channel=0）；邮件记录为 SMTP 队列副本，不重复展示
  std::string where = "WHERE uid = ? AND channel = 0";
  nlohmann::json params = nlohmann::json::array({uid});
  if (unread_only) where += " AND is_read = 0";

  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM notification " + where + ";", params, rows, qerr) !=
      SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  const std::int64_t total = rows.empty() ? 0 : rows[0].value("c", 0);

  params.push_back(page_size);
  params.push_back((page - 1) * page_size);
  if (db.query("SELECT notification_id, type, title, content, is_read, channel, activity_id, "
               "created_at FROM notification " + where + " ORDER BY notification_id DESC LIMIT ? OFFSET ?;",
               params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

nlohmann::json notification_unread_count(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM notification WHERE uid = ? AND channel = 0 AND is_read = 0;",
               nlohmann::json::array({uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"count", rows.empty() ? 0 : rows[0].value("c", 0)}});
}

nlohmann::json notification_read(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t nid = cfg_int(args, "notification_id", 0);
  const int rc = db.execParams("UPDATE notification SET is_read = 1 "
                               "WHERE notification_id = ? AND uid = ?;",
                               nlohmann::json::array({nid, uid}));
  if (rc != SQLITE_OK) return cfg_err(kDbError, "update failed: " + db.lastError());
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "通知不存在");
  return cfg_ok({{"ok", true}});
}

nlohmann::json notification_read_all(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const int rc = db.execParams("UPDATE notification SET is_read = 1 "
                               "WHERE uid = ? AND is_read = 0 AND channel = 0;",
                               nlohmann::json::array({uid}));
  if (rc != SQLITE_OK) return cfg_err(kDbError, "update failed: " + db.lastError());
  return cfg_ok({{"ok", true}});
}

} // namespace sacc
