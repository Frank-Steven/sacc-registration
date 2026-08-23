#include "config/role.h"

#include <sqlite3.h>
#include <vector>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

bool user_exists(Db& db, std::int64_t uid) {
  nlohmann::json rows;
  std::string qerr;
  return db.query("SELECT 1 FROM \"user\" WHERE uid = ? LIMIT 1;",
                  nlohmann::json::array({uid}), rows, qerr) == SQLITE_OK && !rows.empty();
}

} // namespace

nlohmann::json role_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!has_any_admin_role(db, uid)) return cfg_err(kForbidden, "无权限查看角色");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT role_id, name, description FROM role ORDER BY role_id;", nullptr, rows,
               qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json user_role_grant(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可授权");

  const std::int64_t target_uid = cfg_int(args, "target_uid", 0);
  const std::int64_t role_id = cfg_int(args, "role_id", 0);
  if (!user_exists(db, target_uid)) return cfg_err(kNotFound, "目标用户不存在");
  if (role_id < 1 || role_id > 3) return cfg_err(kValidation, "role_id 须为 1~3");

  nlohmann::json group = nullptr;
  if (args.contains("group_id") && !args["group_id"].is_null()) {
    const std::int64_t group_id = cfg_int(args, "group_id", 0);
    if (!group_exists(db, group_id, false)) return cfg_err(kNotFound, "分组不存在");
    if (role_id != 1) group = group_id;  // 超级管理员忽略分组范围
  }

  if (db.execParams("INSERT INTO user_role (uid, role_id, group_id) VALUES (?, ?, ?) "
                    "ON CONFLICT(uid, role_id) DO UPDATE SET group_id = excluded.group_id;",
                    nlohmann::json::array({target_uid, role_id, group})) != SQLITE_OK) {
    return cfg_err(kDbError, "grant failed: " + db.lastError());
  }
  audit_log(db, operator_uid, "grant_role", "user:" + std::to_string(target_uid),
            {{"role_id", role_id}, {"group_id", group.is_null() ? nlohmann::json(nullptr)
                                                                : group}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_role_revoke(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, operator_uid)) return cfg_err(kForbidden, "仅超级管理员可撤销授权");

  const std::int64_t target_uid = cfg_int(args, "target_uid", 0);
  const std::int64_t role_id = cfg_int(args, "role_id", 0);
  if (!user_exists(db, target_uid)) return cfg_err(kNotFound, "目标用户不存在");
  if (role_id < 1 || role_id > 3) return cfg_err(kValidation, "role_id 须为 1~3");

  // 防系统锁死：不得撤销最后一个超级管理员（config.md 6 决策）
  if (role_id == 1) {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT COUNT(*) AS c FROM user_role WHERE role_id = 1;", nullptr, rows,
                 qerr) != SQLITE_OK) {
      return cfg_err(kDbError, "query failed: " + qerr);
    }
    const std::int64_t count = rows.empty() ? 0 : rows[0].value("c", 0);
    if (count <= 1) return cfg_err(kConflict, "无法撤销最后一个超级管理员");
  }

  if (db.execParams("DELETE FROM user_role WHERE uid = ? AND role_id = ?;",
                    nlohmann::json::array({target_uid, role_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "revoke failed: " + db.lastError());
  }
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "该用户无此角色");
  audit_log(db, operator_uid, "revoke_role", "user:" + std::to_string(target_uid),
            {{"role_id", role_id}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json user_role_list(Db& db, const nlohmann::json& args) {
  const std::int64_t operator_uid = cfg_int(args, "uid", 0);
  const std::int64_t target_uid = cfg_int(args, "target_uid", 0);
  if (target_uid <= 0) return cfg_err(kValidation, "target_uid 无效");
  // 用户可查自身角色（M6 管理端 RequireAdmin / 菜单门控依赖此接口）；跨用户查询需超管
  if (target_uid != operator_uid && !is_super_admin(db, operator_uid)) {
    return cfg_err(kForbidden, "仅超级管理员可查看其他用户授权");
  }

  std::string sql =
      "SELECT ur.role_id, r.name AS role_name, ur.group_id, g.name AS group_name "
      "FROM user_role ur JOIN role r ON r.role_id = ur.role_id "
      "LEFT JOIN \"group\" g ON g.group_id = ur.group_id WHERE ur.uid = ?";
  nlohmann::json params = nlohmann::json::array({target_uid});
  if (args.contains("role_id")) {
    sql += " AND ur.role_id = ?";
    params.push_back(cfg_int(args, "role_id", 0));
  }
  sql += " ORDER BY ur.role_id;";
  nlohmann::json rows;
  std::string qerr;
  if (db.query(sql, params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json audit_log_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  // 简化（config.md 1.3 备注）：活动管理员按分组过滤审计暂缓，仅超管可查
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可查看审计日志");

  const std::int64_t page = std::max<std::int64_t>(cfg_int(args, "page", 1), 1);
  const std::int64_t page_size =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "page_size", 20), 1), 100);

  std::vector<std::string> conds;
  nlohmann::json params = nlohmann::json::array();
  if (args.contains("operator_uid") && cfg_int(args, "operator_uid", 0) > 0) {
    conds.push_back("operator_uid = ?");
    params.push_back(cfg_int(args, "operator_uid", 0));
  }
  const std::string action = cfg_str(args, "action");
  if (!action.empty()) {
    conds.push_back("action = ?");
    params.push_back(action);
  }
  if (args.contains("start_time") && cfg_int(args, "start_time", 0) > 0) {
    conds.push_back("created_at >= ?");
    params.push_back(cfg_int(args, "start_time", 0));
  }
  if (args.contains("end_time") && cfg_int(args, "end_time", 0) > 0) {
    conds.push_back("created_at <= ?");
    params.push_back(cfg_int(args, "end_time", 0));
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
  if (db.query("SELECT COUNT(*) AS c FROM audit_log" + where + ";", params, count_rows,
               qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "count failed: " + qerr);
  }
  const std::int64_t total = count_rows.empty() ? 0 : count_rows[0].value("c", 0);

  nlohmann::json rows;
  nlohmann::json list_params = params;
  list_params.push_back(page_size);
  list_params.push_back((page - 1) * page_size);
  if (db.query("SELECT log_id, operator_uid, action, target, detail, created_at "
               "FROM audit_log" + where + " ORDER BY log_id DESC LIMIT ? OFFSET ?;",
               list_params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "list failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

} // namespace sacc
