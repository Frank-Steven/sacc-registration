#include "config/group.h"

#include <map>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// 目标分组是否为 group_id 的后代（含自身）→ 用于禁止移动到自身子树
bool is_descendant(Db& db, std::int64_t ancestor, std::int64_t target) {
  nlohmann::json rows;
  std::string qerr;
  const std::string sql =
      "WITH RECURSIVE sub(gid) AS ("
      "  SELECT ? "
      "  UNION ALL "
      "  SELECT g.group_id FROM \"group\" g JOIN sub s ON g.parent_id = s.gid "
      "    AND g.is_deleted = 0 "
      ") "
      "SELECT 1 FROM sub WHERE gid = ? LIMIT 1;";
  if (db.query(sql, nlohmann::json::array({ancestor, target}), rows, qerr) != SQLITE_OK) {
    return true; // 查询失败按不安全处理
  }
  return !rows.empty();
}

} // namespace

nlohmann::json group_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可管理分组");
  const std::string name = cfg_str(args, "name");
  if (name.empty() || name.size() > 50) return cfg_err(kValidation, "分组名称须为 1~50 字符");
  const std::int64_t parent_id = cfg_int(args, "parent_id", 0);
  if (parent_id != 0 && !group_exists(db, parent_id, false)) {
    return cfg_err(kNotFound, "父分组不存在");
  }
  if (db.execParams("INSERT INTO \"group\" (parent_id, name, sort_order, is_deleted, created_at) "
                    "VALUES (?, ?, ?, 0, ?);",
                    nlohmann::json::array({parent_id == 0 ? nullptr : nlohmann::json(parent_id),
                                           name, cfg_int(args, "sort_order", 0), now_ts()})) !=
      SQLITE_OK) {
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t group_id = db.lastInsertRowid();
  audit_log(db, uid, "create_group", "group:" + std::to_string(group_id), {{"name", name}});
  return cfg_ok({{"group_id", group_id}});
}

nlohmann::json group_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t group_id = cfg_int(args, "group_id", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可管理分组");
  if (!group_exists(db, group_id, true)) return cfg_err(kNotFound, "分组不存在");

  const std::string name = cfg_str(args, "name");
  if (!name.empty() && name.size() > 50) return cfg_err(kValidation, "分组名称须为 1~50 字符");
  const std::int64_t parent_id = cfg_int(args, "parent_id", 0);
  if (parent_id != 0) {
    if (!group_exists(db, parent_id, false)) return cfg_err(kNotFound, "父分组不存在");
    if (parent_id == group_id || is_descendant(db, group_id, parent_id)) {
      return cfg_err(kConflict, "不能将分组移动到自身或其子分组下");
    }
  }

  std::string sql = "UPDATE \"group\" SET ";
  nlohmann::json params = nlohmann::json::array();
  if (!name.empty()) {
    sql += "name = ?, ";
    params.push_back(name);
  }
  if (args.contains("sort_order")) {
    sql += "sort_order = ?, ";
    params.push_back(cfg_int(args, "sort_order", 0));
  }
  if (args.contains("parent_id")) {
    sql += "parent_id = ?, ";
    params.push_back(parent_id == 0 ? nullptr : nlohmann::json(parent_id));
  }
  if (params.empty()) return cfg_ok({{"ok", true}});  // 无可更新字段
  sql.resize(sql.size() - 2);
  sql += " WHERE group_id = ?;";
  params.push_back(group_id);
  if (db.execParams(sql, params) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "update_group", "group:" + std::to_string(group_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json group_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t group_id = cfg_int(args, "group_id", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可管理分组");
  if (!group_exists(db, group_id, false)) return cfg_err(kNotFound, "分组不存在");

  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM \"group\" WHERE parent_id = ? AND is_deleted = 0 LIMIT 1;",
                 nlohmann::json::array({group_id}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      return cfg_err(kConflict, "存在子分组，无法删除");
    }
  }
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM activity_group WHERE group_id = ? LIMIT 1;",
                 nlohmann::json::array({group_id}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      return cfg_err(kConflict, "分组已绑定活动，无法删除");
    }
  }
  if (db.execParams("UPDATE \"group\" SET is_deleted = 1 WHERE group_id = ?;",
                    nlohmann::json::array({group_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "delete_group", "group:" + std::to_string(group_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json group_tree(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_super_admin(db, uid)) return cfg_err(kForbidden, "仅超级管理员可管理分组");
  nlohmann::json rows;
  std::string qerr;
  // 扁平列表（含 parent_id），前端按需组树；含软删标记
  if (db.query("SELECT group_id, parent_id, name, sort_order, is_deleted, created_at "
               "FROM \"group\" ORDER BY parent_id, sort_order, group_id;",
               nullptr, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json group_public_tree(Db& db, const nlohmann::json& args) {
  (void)args;  // 公开接口，无鉴权
  nlohmann::json rows;
  std::string qerr;
  // 仅未软删分组；扁平按 parent_id, sort_order 排序（父必先于子，组树构建前提）
  if (db.query("SELECT group_id, parent_id, name FROM \"group\" WHERE is_deleted = 0 "
               "ORDER BY parent_id, sort_order, group_id;",
               nullptr, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  nlohmann::json nodes = nlohmann::json::array();
  std::map<std::int64_t, std::size_t> idx;
  for (const auto& r : rows) {
    idx[r.value("group_id", 0)] = nodes.size();
    nodes.push_back({
        {"group_id", r.value("group_id", 0)},
        {"parent_id", r["parent_id"].is_null() ? nlohmann::json(nullptr)
                                               : nlohmann::json(r.value("parent_id", 0))},
        {"name", r.value("name", "")},
        {"children", nlohmann::json::array()},
    });
  }
  // 逆序遍历：先组装后代，挂接父节点时 children 已完整
  nlohmann::json roots = nlohmann::json::array();
  for (std::size_t i = nodes.size(); i-- > 0;) {
    const std::int64_t pid =
        nodes[i]["parent_id"].is_null() ? 0 : nodes[i]["parent_id"].get<std::int64_t>();
    const auto it = idx.find(pid);
    if (pid != 0 && it != idx.end()) {
      nodes[it->second]["children"].push_back(std::move(nodes[i]));
    } else {
      roots.push_back(std::move(nodes[i]));  // 根节点 / 孤儿（父被软删）提升为根
    }
  }
  return cfg_ok({{"items", std::move(roots)}});
}

nlohmann::json activity_group_bind(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::int64_t group_id = cfg_int(args, "group_id", 0);
  nlohmann::json row;
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) {
    return cfg_err(kForbidden, "无权限绑定该活动");
  }
  if (!group_exists(db, group_id, false)) return cfg_err(kNotFound, "分组不存在");
  if (!group_in_scope(db, uid, 2, group_id)) {
    return cfg_err(kForbidden, "分组不在授权范围内");
  }
  if (db.execParams("INSERT OR IGNORE INTO activity_group (activity_id, group_id) VALUES (?, ?);",
                    nlohmann::json::array({activity_id, group_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "bind failed: " + db.lastError());
  }
  audit_log(db, uid, "bind_group", "activity:" + std::to_string(activity_id),
            {{"group_id", group_id}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json activity_group_unbind(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::int64_t group_id = cfg_int(args, "group_id", 0);
  nlohmann::json row;
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) {
    return cfg_err(kForbidden, "无权限解绑该活动");
  }
  if (db.execParams("DELETE FROM activity_group WHERE activity_id = ? AND group_id = ?;",
                    nlohmann::json::array({activity_id, group_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "unbind failed: " + db.lastError());
  }
  audit_log(db, uid, "unbind_group", "activity:" + std::to_string(activity_id),
            {{"group_id", group_id}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json activity_group_list(Db& db, const nlohmann::json& args) {
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT g.group_id, g.parent_id, g.name, g.sort_order FROM activity_group ag "
               "JOIN \"group\" g ON g.group_id = ag.group_id "
               "WHERE ag.activity_id = ? AND g.is_deleted = 0 "
               "ORDER BY g.sort_order, g.group_id;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

} // namespace sacc
