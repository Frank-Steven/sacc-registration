#include "config/authz.h"

#include <cerrno>
#include <cstdlib>
#include <sqlite3.h>

#include "core/errors.h"
#include "core/util.h"

namespace sacc {

std::string cfg_str(const nlohmann::json& args, const char* key) {
  const auto it = args.find(key);
  if (it == args.end() || !it->is_string()) return "";
  return it->get<std::string>();
}

std::int64_t cfg_int(const nlohmann::json& args, const char* key, std::int64_t def) {
  const auto it = args.find(key);
  if (it == args.end()) return def;
  if (it->is_number_integer()) return it->get<std::int64_t>();
  if (it->is_number_unsigned()) return static_cast<std::int64_t>(it->get<std::uint64_t>());
  if (it->is_boolean()) return it->get<bool>() ? 1 : 0;
  if (it->is_string()) {
    // wasm 无异常构建，用 strtoll 替代 std::stoll（无 throw）
    const std::string& s = it->get<std::string>();
    if (s.empty()) return def;
    errno = 0;
    char* end = nullptr;
    const long long v = std::strtoll(s.c_str(), &end, 10);
    if (errno == ERANGE || end != s.c_str() + s.size()) return def;  // 溢出/非纯数字串
    return v;
  }
  return def;
}

bool json_parse_lenient(const std::string& s, nlohmann::json& out) {
  out = nlohmann::json::parse(s, nullptr, false);
  return !out.is_discarded();
}

bool cfg_bool(const nlohmann::json& args, const char* key, bool def) {
  const auto it = args.find(key);
  if (it == args.end()) return def;
  if (it->is_boolean()) return it->get<bool>();
  if (it->is_number_integer()) return it->get<int>() != 0;
  if (it->is_string()) {
    const std::string s = it->get<std::string>();
    return s == "1" || s == "true";
  }
  return def;
}

namespace {

bool has_role(Db& db, std::int64_t uid, int role_id) {
  if (uid <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT 1 FROM user_role WHERE uid = ? AND role_id = ? LIMIT 1;",
               nlohmann::json::array({uid, role_id}), rows, qerr) != SQLITE_OK) {
    return false;
  }
  return !rows.empty();
}

// 权限判定递归 CTE：从 user_role 授权分组（非 NULL）向下展开，role 1 恒放行
const char* kScopeCtePrefix =
    "WITH RECURSIVE scope(gid) AS ("
    "  SELECT ur.group_id FROM user_role ur WHERE ur.uid = ? AND ur.role_id = ? "
    "    AND ur.group_id IS NOT NULL "
    "  UNION ALL "
    "  SELECT g.group_id FROM \"group\" g JOIN scope s ON g.parent_id = s.gid "
    "    AND g.is_deleted = 0 "
    ") ";

} // namespace

bool is_super_admin(Db& db, std::int64_t uid) { return has_role(db, uid, 1); }

bool has_any_admin_role(Db& db, std::int64_t uid) {
  return has_role(db, uid, 1) || has_role(db, uid, 2) || has_role(db, uid, 3);
}

bool is_manager(Db& db, std::int64_t uid) {
  return has_role(db, uid, 1) || has_role(db, uid, 2);
}

bool group_in_scope(Db& db, std::int64_t uid, int role_id, std::int64_t group_id) {
  if (uid <= 0 || group_id <= 0) return false;
  if (is_super_admin(db, uid)) return true;
  nlohmann::json rows;
  std::string qerr;
  // 全范围授权（group_id IS NULL）直接放行
  if (db.query("SELECT 1 FROM user_role WHERE uid = ? AND role_id = ? AND group_id IS NULL LIMIT 1;",
               nlohmann::json::array({uid, role_id}), rows, qerr) == SQLITE_OK &&
      !rows.empty()) {
    return true;
  }
  const std::string sql = std::string(kScopeCtePrefix) +
      "SELECT 1 FROM scope WHERE gid = ? AND EXISTS "
      "(SELECT 1 FROM \"group\" WHERE group_id = ? AND is_deleted = 0) LIMIT 1;";
  rows.clear();
  if (db.query(sql, nlohmann::json::array({uid, role_id, group_id, group_id}), rows, qerr) !=
      SQLITE_OK) {
    return false;
  }
  return !rows.empty();
}

bool activity_in_scope(Db& db, std::int64_t uid, int role_id, std::int64_t activity_id) {
  if (uid <= 0 || activity_id <= 0) return false;
  if (is_super_admin(db, uid)) return true;
  nlohmann::json rows;
  std::string qerr;
  // 全范围授权直接放行
  if (db.query("SELECT 1 FROM user_role WHERE uid = ? AND role_id = ? AND group_id IS NULL LIMIT 1;",
               nlohmann::json::array({uid, role_id}), rows, qerr) == SQLITE_OK &&
      !rows.empty()) {
    return true;
  }
  const std::string sql = std::string(kScopeCtePrefix) +
      "SELECT 1 FROM activity_group ag JOIN scope s ON ag.group_id = s.gid "
      "WHERE ag.activity_id = ? LIMIT 1;";
  rows.clear();
  if (db.query(sql, nlohmann::json::array({uid, role_id, activity_id}), rows, qerr) != SQLITE_OK) {
    return false;
  }
  return !rows.empty();
}

bool can_manage_activity(Db& db, std::int64_t uid, std::int64_t activity_id) {
  if (!is_manager(db, uid)) return false;
  return activity_in_scope(db, uid, 2, activity_id);
}

bool can_read_activity(Db& db, std::int64_t uid, std::int64_t activity_id) {
  if (is_super_admin(db, uid)) return true;
  return activity_in_scope(db, uid, 2, activity_id) ||
         activity_in_scope(db, uid, 3, activity_id);
}

bool activity_row(Db& db, std::int64_t activity_id, bool include_deleted, nlohmann::json& out) {
  if (activity_id <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  const std::string sql = include_deleted
      ? "SELECT * FROM activity WHERE activity_id = ? LIMIT 1;"
      : "SELECT * FROM activity WHERE activity_id = ? AND is_deleted = 0 LIMIT 1;";
  if (db.query(sql, nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK) return false;
  if (rows.empty()) return false;
  out = std::move(rows[0]);
  return true;
}

bool group_exists(Db& db, std::int64_t group_id, bool include_deleted) {
  if (group_id <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  const std::string sql = include_deleted
      ? "SELECT 1 FROM \"group\" WHERE group_id = ? LIMIT 1;"
      : "SELECT 1 FROM \"group\" WHERE group_id = ? AND is_deleted = 0 LIMIT 1;";
  if (db.query(sql, nlohmann::json::array({group_id}), rows, qerr) != SQLITE_OK) return false;
  return !rows.empty();
}

bool form_row(Db& db, std::int64_t form_id, bool include_deleted, nlohmann::json& out) {
  if (form_id <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  const std::string sql = include_deleted
      ? "SELECT * FROM form WHERE form_id = ? LIMIT 1;"
      : "SELECT * FROM form WHERE form_id = ? AND is_deleted = 0 LIMIT 1;";
  if (db.query(sql, nlohmann::json::array({form_id}), rows, qerr) != SQLITE_OK) return false;
  if (rows.empty()) return false;
  out = std::move(rows[0]);
  return true;
}

bool field_row(Db& db, std::int64_t field_id, bool include_deleted, nlohmann::json& out) {
  if (field_id <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  const std::string sql = include_deleted
      ? "SELECT * FROM form_field WHERE field_id = ? LIMIT 1;"
      : "SELECT * FROM form_field WHERE field_id = ? AND is_deleted = 0 LIMIT 1;";
  if (db.query(sql, nlohmann::json::array({field_id}), rows, qerr) != SQLITE_OK) return false;
  if (rows.empty()) return false;
  out = std::move(rows[0]);
  return true;
}

void audit_log(Db& db, std::int64_t operator_uid, const std::string& action,
               const std::string& target, const nlohmann::json& detail) {
  db.execParams("INSERT INTO audit_log (operator_uid, action, target, detail, created_at) "
                "VALUES (?, ?, ?, ?, ?);",
                nlohmann::json::array({operator_uid, action, target, detail.dump(), now_ts()}));
}

bool valid_status_transition(int from, int to, std::int64_t end_time, std::int64_t now) {
  if (from == to) return true;
  switch (from) {
    case 0: return to == 1;                                    // 草稿 → 进行中
    case 1: return to == 0 || to == 2;                         // 进行中 → 撤回 / 截止
    case 2:                                                    // 已截止 → 重开 / 结束
      return (to == 1 && (end_time == 0 || now < end_time)) || to == 3;
    case 3: return false;                                      // 已结束 终态
    default: return false;
  }
}

} // namespace sacc
