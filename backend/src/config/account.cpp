#include "config/account.h"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"
#include "crypto/kdf.h"
#include "user/auth.h"

namespace sacc {

namespace {

// 随机密码字符集：去除易混淆字符（0O1lI）
constexpr const char* kResetChars =
    "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
constexpr std::size_t kResetCharsLen = 55; // sizeof(kResetChars) - 1

std::string random_password(std::size_t len) {
  std::string pwd;
  pwd.reserve(len);
  unsigned char b;
  for (std::size_t i = 0; i < len; ++i) {
    random_bytes(&b, 1);
    pwd.push_back(kResetChars[b % kResetCharsLen]);
  }
  return pwd;
}

// 目标账号存在性（account + user 双表）
bool account_exists(Db& db, std::int64_t uid) {
  nlohmann::json rows;
  std::string qerr;
  return db.query("SELECT uid FROM account WHERE uid = ?;",
                  nlohmann::json::array({uid}), rows, qerr) == SQLITE_OK &&
         !rows.empty();
}

// 批量角色聚合：items 每行补 roles（uid → 角色数组）
void attach_roles(Db& db, nlohmann::json& items) {
  std::vector<std::int64_t> uids;
  for (const auto& it : items) uids.push_back(it.value("uid", 0));
  if (uids.empty()) return;

  std::string in;
  nlohmann::json params = nlohmann::json::array();
  for (std::size_t i = 0; i < uids.size(); ++i) {
    if (i) in += ",";
    in += "?";
    params.push_back(uids[i]);
  }
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT ur.uid, ur.role_id, r.name AS role_name, ur.group_id, "
               "g.name AS group_name FROM user_role ur "
               "JOIN role r ON r.role_id = ur.role_id "
               "LEFT JOIN \"group\" g ON g.group_id = ur.group_id "
               "WHERE ur.uid IN (" + in + ") ORDER BY ur.role_id;",
               params, rows, qerr) != SQLITE_OK) {
    return;
  }
  std::map<std::int64_t, nlohmann::json> by_uid;
  for (const auto& row : rows) {
    const std::int64_t uid = row.value("uid", 0);
    nlohmann::json gid = row["group_id"].is_null() ? nlohmann::json(nullptr)
                                                   : nlohmann::json(row.value("group_id", 0));
    nlohmann::json gname = row["group_name"].is_null() ? nlohmann::json(nullptr)
                                                       : nlohmann::json(row.value("group_name", ""));
    nlohmann::json r = {{"role_id", row.value("role_id", 0)},
                        {"role_name", row.value("role_name", "")},
                        {"group_id", std::move(gid)},
                        {"group_name", std::move(gname)}};
    by_uid[uid].push_back(std::move(r));
  }
  for (auto& it : items) {
    const auto f = by_uid.find(it.value("uid", 0));
    it["roles"] = f == by_uid.end() ? nlohmann::json::array() : f->second;
  }
}

} // namespace

nlohmann::json account_admin_list(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可管理账号");

  const std::int64_t page = std::max<std::int64_t>(cfg_int(args, "page", 1), 1);
  const std::int64_t page_size =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "page_size", 20), 1), 100);

  std::vector<std::string> conds;
  nlohmann::json params = nlohmann::json::array();
  const std::string keyword = cfg_str(args, "keyword");
  if (!keyword.empty()) {
    const std::string kw = "%" + escape_like(keyword) + "%";
    conds.push_back("(a.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' "
                    "OR u.student_id LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')");
    for (int i = 0; i < 4; ++i) params.push_back(kw);
  }
  if (args.contains("status")) {
    const std::int64_t st = cfg_int(args, "status", -1);
    if (st != 0 && st != 1) return cfg_err(kValidation, "status 须为 0 或 1");
    conds.push_back("a.status = ?");
    params.push_back(st);
  }
  std::string where = conds.empty() ? "" : " WHERE " + [&] {
    std::string s;
    for (std::size_t i = 0; i < conds.size(); ++i) {
      if (i) s += " AND ";
      s += conds[i];
    }
    return s;
  }();

  nlohmann::json count_rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM account a JOIN \"user\" u ON u.uid = a.uid" + where +
                   ";",
               params, count_rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "count failed: " + qerr);
  }
  const std::int64_t total = count_rows.empty() ? 0 : count_rows[0].value("c", 0);

  nlohmann::json items;
  nlohmann::json list_params = params;
  list_params.push_back(page_size);
  list_params.push_back((page - 1) * page_size);
  if (db.query("SELECT a.uid, a.username, a.status, a.last_login_at, a.created_at, "
               "u.name, u.student_id, u.college, u.phone, u.email "
               "FROM account a JOIN \"user\" u ON u.uid = a.uid" + where +
                   " ORDER BY a.uid DESC LIMIT ? OFFSET ?;",
               list_params, items, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "list failed: " + qerr);
  }
  attach_roles(db, items);
  return cfg_ok({{"items", std::move(items)}, {"total", total}});
}

nlohmann::json account_set_status(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可管理账号");

  const std::int64_t target_uid = cfg_int(args, "target_uid", 0);
  const std::int64_t status = cfg_int(args, "status", -1);
  if (target_uid <= 0) return cfg_err(kValidation, "target_uid 无效");
  if (status != 0 && status != 1) return cfg_err(kValidation, "status 须为 0 或 1");
  if (target_uid == operator_uid) return cfg_err(kConflict, "不能禁用/启用当前登录账号");
  if (!account_exists(db, target_uid)) return cfg_err(kNotFound, "账号不存在");

  if (db.execParams("UPDATE account SET status = ? WHERE uid = ?;",
                    nlohmann::json::array({status, target_uid})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, operator_uid, "account.set_status", "user:" + std::to_string(target_uid),
            {{"status", status}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json account_admin_reset(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可管理账号");

  const std::int64_t target_uid = cfg_int(args, "target_uid", 0);
  if (target_uid <= 0) return cfg_err(kValidation, "target_uid 无效");
  if (!account_exists(db, target_uid)) return cfg_err(kNotFound, "账号不存在");

  const std::string password = random_password(12);
  std::string salt_hex, hash_hex;
  hash_password(password, salt_hex, hash_hex);
  if (db.execParams("UPDATE account SET password_hash = ?, salt = ?, login_fail_count = 0, "
                    "lock_until = NULL, reset_token = NULL, reset_expire = NULL WHERE uid = ?;",
                    nlohmann::json::array({hash_hex, salt_hex, target_uid})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, operator_uid, "account.admin_reset", "user:" + std::to_string(target_uid), {});
  return cfg_ok({{"password", password}});
}

nlohmann::json db_stats(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可查看数据统计");

  nlohmann::json tables;
  std::string qerr;
  if (db.query("SELECT name FROM sqlite_master WHERE type = 'table' "
               "AND name NOT LIKE 'sqlite_%' ORDER BY name;",
               nullptr, tables, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  nlohmann::json table_counts = nlohmann::json::object();
  for (const auto& t : tables) {
    const std::string name = t.value("name", "");
    nlohmann::json rows;
    if (db.query("SELECT COUNT(*) AS c FROM \"" + name + "\";", nullptr, rows, qerr) != SQLITE_OK) {
      continue;
    }
    table_counts[name] = rows.empty() ? 0 : rows[0].value("c", 0);
  }
  // 软删实体（配置层约定，overview.md 三）
  nlohmann::json deleted_counts = nlohmann::json::object();
  for (const std::string& t : {"activity", "group", "form", "form_field"}) {
    nlohmann::json rows;
    if (db.query("SELECT COUNT(*) AS c FROM \"" + t + "\" WHERE is_deleted = 1;", nullptr, rows,
                 qerr) == SQLITE_OK) {
      deleted_counts[t] = rows.empty() ? 0 : rows[0].value("c", 0);
    }
  }
  // 库大小 = page_count × page_size
  std::int64_t db_size = 0;
  {
    nlohmann::json pc, ps;
    if (db.query("PRAGMA page_count;", nullptr, pc, qerr) == SQLITE_OK && !pc.empty() &&
        db.query("PRAGMA page_size;", nullptr, ps, qerr) == SQLITE_OK && !ps.empty()) {
      db_size = pc[0].value("page_count", 0) * ps[0].value("page_size", 0);
    }
  }
  return cfg_ok({{"table_counts", std::move(table_counts)},
                 {"deleted_counts", std::move(deleted_counts)},
                 {"db_size", db_size}});
}

} // namespace sacc
