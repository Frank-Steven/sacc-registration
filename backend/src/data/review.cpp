#include "data/review.h"

#include <sqlite3.h>

#include "config/authz.h"
#include "core/util.h"
#include "data/notification.h"
#include "data/registration.h"

namespace sacc {

namespace {
constexpr int kForbidden = 403;
constexpr int kNotFound = 404;
constexpr int kConflict = 409;
constexpr int kDbError = 2001;

// 审核权限：活动管理员（role2）或审核员（role3）且活动在授权范围内（超管恒放行）
bool can_review_activity(Db& db, std::int64_t uid, std::int64_t activity_id) {
  if (uid <= 0) return false;
  if (is_super_admin(db, uid)) return true;
  return activity_in_scope(db, uid, 2, activity_id) || activity_in_scope(db, uid, 3, activity_id);
}

} // namespace

nlohmann::json registration_review(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!registration_row(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  const std::int64_t activity_id = row["activity_id"].get<std::int64_t>();
  if (!can_review_activity(db, uid, activity_id)) {
    return cfg_err(kForbidden, "无审核权限");
  }
  if (row.value("status", 0) != 1) return cfg_err(kConflict, "仅待审核的报名可审核");

  const bool approve = cfg_bool(args, "approve", false);
  const std::string remark = cfg_str(args, "review_remark");
  const std::int64_t now = now_ts();
  const int new_status = approve ? 2 : 3;

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  if (db.execParams("UPDATE registration SET status = ?, reviewer = ?, review_time = ?, "
                    "review_remark = ?, updated_at = ? WHERE registration_id = ?;",
                    nlohmann::json::array({new_status, uid, now, remark, now, registration_id})) !=
      SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  if (!approve) {
    // 驳回释放名额 → 同步递补候补队首（同一事务）
    promote_waitlist(db, activity_id, now);
  }
  if (db.commit() != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "commit failed: " + db.lastError());
  }

  const std::int64_t target_uid = row["uid"].get<std::int64_t>();
  if (approve) {
    notify(db, target_uid, 1, "审核通过",
           "您报名的「" + row.value("activity_name", "") + "」已审核通过。", activity_id);
  } else {
    notify(db, target_uid, 1, "审核未通过",
           "您报名的「" + row.value("activity_name", "") +
               "」未通过审核" + (remark.empty() ? "。" : "，理由：" + remark + "。"),
           activity_id);
  }
  audit_log(db, uid, "review_registration", "registration:" + std::to_string(registration_id),
            {{"approve", approve}, {"review_remark", remark}});
  return cfg_ok({{"ok", true}, {"status", new_status}});
}

} // namespace sacc
