#include "data/checkin.h"

#include <cstdio>
#include <cstring>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"
#include "crypto/kdf.h"
#include "data/registration.h"

namespace sacc {

namespace {

// 审核 / 签到管理权限：活动管理员（role2）或审核员（role3），活动在授权范围（超管恒放行）
bool can_checkin_activity(Db& db, std::int64_t uid, std::int64_t activity_id) {
  if (uid <= 0) return false;
  if (is_super_admin(db, uid)) return true;
  return activity_in_scope(db, uid, 2, activity_id) || activity_in_scope(db, uid, 3, activity_id);
}

// 活动签到模式（activity_config.checkin_mode）：0 现场 / 1 线上自助 / 2 线上动态码
int checkin_mode_of(Db& db, std::int64_t activity_id) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_value FROM activity_config "
               "WHERE activity_id = ? AND config_key = 'checkin_mode' LIMIT 1;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK || rows.empty()) {
    return 0;
  }
  const std::string v = rows[0].value("config_value", "0");
  if (v == "1") return 1;
  if (v == "2") return 2;
  return 0;
}

// 系统级动态码密钥（system_config.checkin_secret，仅超管可写）
std::string checkin_secret(Db& db) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT config_value FROM system_config WHERE config_key = 'checkin_secret' "
               "LIMIT 1;",
               nullptr, rows, qerr) != SQLITE_OK || rows.empty()) {
    return "";
  }
  return rows[0].value("config_value", "");
}

// TOTP 风格动态码（registration.md 6.1）：HMAC-SHA256(secret, "sacc-checkin:"+aid+":"+slot)
// 输出前 4 字节转 uint32 取模 1_000_000，补零 6 位；time_slot = floor(now / 60)
std::string totp_code(const std::string& secret, std::int64_t activity_id, std::int64_t slot) {
  const std::string msg =
      "sacc-checkin:" + std::to_string(activity_id) + ":" + std::to_string(slot);
  unsigned char mac[32];
  hmac_sha256(reinterpret_cast<const unsigned char*>(secret.data()), secret.size(),
              reinterpret_cast<const unsigned char*>(msg.data()), msg.size(), mac);
  const std::uint32_t v = (static_cast<std::uint32_t>(mac[0]) << 24) |
                          (static_cast<std::uint32_t>(mac[1]) << 16) |
                          (static_cast<std::uint32_t>(mac[2]) << 8) | mac[3];
  char buf[8];
  std::snprintf(buf, sizeof(buf), "%06u", v % 1000000u);
  return buf;
}

// 校验动态码：接受当前槽 + 前 1 槽（防跨槽边界）；secret 由调用方先取（区分未配置与输错）
bool code_valid(const std::string& secret, std::int64_t activity_id, const std::string& code,
                std::int64_t now) {
  if (secret.empty() || code.size() != 6) return false;
  const std::int64_t slot = now / 60;
  if (totp_code(secret, activity_id, slot) == code) return true;
  return totp_code(secret, activity_id, slot - 1) == code;
}

// 写入签到时间并返回 ok 响应；已签到返回 409
nlohmann::json do_checkin(Db& db, std::int64_t registration_id, std::int64_t operator_uid,
                          bool audit) {
  nlohmann::json row;
  if (!registration_row(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row.value("status", 0) != 2) return cfg_err(kConflict, "仅已通过的报名可签到");
  if (!row["checkin_time"].is_null()) return cfg_err(kConflict, "该报名已签到");
  const std::int64_t now = now_ts();
  if (db.execParams("UPDATE registration SET checkin_time = ?, updated_at = ? "
                    "WHERE registration_id = ?;",
                    nlohmann::json::array({now, now, registration_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  if (audit) {
    audit_log(db, operator_uid, "checkin_registration", "registration:" + std::to_string(registration_id),
              nlohmann::json{{"activity_id", row.value("activity_id", 0)}});
  }
  return cfg_ok({{"ok", true}, {"checkin_time", now}});
}

} // namespace

nlohmann::json checkin_do(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (registration_id <= 0) {
    const std::string receipt = cfg_str(args, "receipt_no");
    if (receipt.empty()) return cfg_err(kNotFound, "缺少报名标识");
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT registration_id FROM registration WHERE receipt_no = ? LIMIT 1;",
                 nlohmann::json::array({receipt}), rows, qerr) != SQLITE_OK) {
      return cfg_err(kDbError, "query failed: " + qerr);
    }
    if (rows.empty()) return cfg_err(kNotFound, "凭证号不存在");
    registration_id = rows[0]["registration_id"].get<std::int64_t>();
  }
  nlohmann::json row;
  if (!registration_row(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (!can_checkin_activity(db, uid, row["activity_id"].get<std::int64_t>())) {
    return cfg_err(kForbidden, "无签到权限");
  }
  return do_checkin(db, registration_id, uid, true);
}

nlohmann::json checkin_mine(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!registration_row(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row["uid"].get<std::int64_t>() != uid) return cfg_err(kForbidden, "无权操作该报名");
  if (checkin_mode_of(db, row["activity_id"].get<std::int64_t>()) != 1) {
    return cfg_err(kConflict, "该活动不支持线上自助签到");
  }
  return do_checkin(db, registration_id, uid, false);
}

nlohmann::json checkin_code(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::string code = cfg_str(args, "code");
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  if (checkin_mode_of(db, activity_id) != 2) return cfg_err(kConflict, "该活动未开启动态码签到");

  // 本人已通过报名且未签到
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT registration_id FROM registration WHERE activity_id = ? AND uid = ? "
               "AND status = 2 AND checkin_time IS NULL ORDER BY registration_id LIMIT 1;",
               nlohmann::json::array({activity_id, uid}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (rows.empty()) return cfg_err(kConflict, "无待签到的已通过报名");

  const std::string secret = checkin_secret(db);
  if (secret.empty()) return cfg_err(kValidation, "未配置签到密钥（system_config.checkin_secret）");
  const std::int64_t now = now_ts();
  if (!code_valid(secret, activity_id, code, now)) return cfg_err(kValidation, "签到码错误或已过期");
  return do_checkin(db, rows[0]["registration_id"].get<std::int64_t>(), uid, false);
}

nlohmann::json checkin_code_current(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) {
    return cfg_err(kNotFound, "活动不存在");
  }
  if (!can_checkin_activity(db, uid, activity_id)) return cfg_err(kForbidden, "活动不在授权范围");
  const std::string secret = checkin_secret(db);
  if (secret.empty()) return cfg_err(kValidation, "未配置签到密钥（system_config.checkin_secret）");
  const std::int64_t now = now_ts();
  const std::int64_t expires_in = 60 - (now % 60);
  return cfg_ok({{"code", totp_code(secret, activity_id, now / 60)}, {"expires_in", expires_in}});
}

} // namespace sacc
