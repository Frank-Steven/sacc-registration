#include "data/subscribe.h"

#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

} // namespace

nlohmann::json subscribe_add(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (activity_id <= 0) return cfg_err(kNotFound, "活动不存在");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  const int rc = db.execParams(
      "INSERT INTO subscribe (uid, activity_id, created_at) VALUES (?, ?, ?);",
      nlohmann::json::array({uid, activity_id, now_ts()}));
  if (rc != SQLITE_OK) {
    if (rc == SQLITE_CONSTRAINT) return cfg_err(kConflict, "已订阅该活动");
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json subscribe_remove(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const int rc = db.execParams("DELETE FROM subscribe WHERE uid = ? AND activity_id = ?;",
                               nlohmann::json::array({uid, activity_id}));
  if (rc != SQLITE_OK) return cfg_err(kDbError, "delete failed: " + db.lastError());
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "未订阅该活动");
  return cfg_ok({{"ok", true}});
}

nlohmann::json subscribe_mine(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT a.activity_id, a.name, a.activity_type, a.start_time, a.end_time, "
               "a.status, s.created_at AS subscribed_at "
               "FROM subscribe s JOIN activity a ON s.activity_id = a.activity_id "
               "WHERE s.uid = ? AND a.is_deleted = 0 ORDER BY s.created_at DESC;",
               nlohmann::json::array({uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

} // namespace sacc
