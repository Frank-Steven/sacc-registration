#include "config/activity.h"

#include <sqlite3.h>
#include <vector>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// 活动公开字段（报名端视图）
nlohmann::json publicActivity(const nlohmann::json& row) {
  return {
      {"activity_id", row.value("activity_id", 0)},
      {"name", row.value("name", "")},
      {"description", row.value("description", "")},
      {"activity_type", row.value("activity_type", 0)},
      {"start_time", row.value("start_time", 0)},
      {"end_time", row.value("end_time", 0)},
      {"max_slots", row.value("max_slots", 0)},
      {"need_review", row.value("need_review", 0)},
      {"allow_modify", row.value("allow_modify", 0)},
  };
}

// 校验可写字段并构建活动基础信息（返回 nullptr 或错误响应）
const nlohmann::json* validateBase(const nlohmann::json& args) {
  static const nlohmann::json empty;
  if (!args.contains("name")) return nullptr;
  const std::string name = cfg_str(args, "name");
  if (name.empty() || name.size() > 100) {
    static const nlohmann::json err = cfg_err(kValidation, "活动名称须为 1~100 字符");
    return &err;
  }
  const std::int64_t type = cfg_int(args, "activity_type", 0);
  if (type < 0 || type > 2) {
    static const nlohmann::json err = cfg_err(kValidation, "activity_type 须为 0/1/2");
    return &err;
  }
  const std::int64_t start = cfg_int(args, "start_time", 0);
  const std::int64_t end = cfg_int(args, "end_time", 0);
  if (start < 0 || end < 0 || (end != 0 && start != 0 && end < start)) {
    static const nlohmann::json err = cfg_err(kValidation, "时间参数不合法（end 不得早于 start）");
    return &err;
  }
  if (cfg_int(args, "max_slots", 0) < 0) {
    static const nlohmann::json err = cfg_err(kValidation, "max_slots 不得为负");
    return &err;
  }
  return nullptr;
}

// 构建活动详情：活动 + 分组 + 表单（含字段）
nlohmann::json buildDetail(Db& db, const nlohmann::json& row) {
  nlohmann::json detail;
  for (auto it = row.begin(); it != row.end(); ++it) detail[it.key()] = it.value();
  detail["is_deleted"] = row.value("is_deleted", 0);

  nlohmann::json groups = nlohmann::json::array();
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT g.group_id, g.name, g.sort_order FROM activity_group ag "
                 "JOIN \"group\" g ON g.group_id = ag.group_id "
                 "WHERE ag.activity_id = ? AND g.is_deleted = 0 ORDER BY g.sort_order, g.group_id;",
                 nlohmann::json::array({row.value("activity_id", 0)}), rows, qerr) == SQLITE_OK) {
      groups = std::move(rows);
    }
  }
  detail["groups"] = std::move(groups);

  nlohmann::json forms = nlohmann::json::array();
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT form_id, activity_id, name, sort_order, is_required, created_at "
                 "FROM form WHERE activity_id = ? AND is_deleted = 0 "
                 "ORDER BY sort_order, form_id;",
                 nlohmann::json::array({row.value("activity_id", 0)}), rows, qerr) == SQLITE_OK) {
      for (const auto& f : rows) {
        nlohmann::json form = f;
        nlohmann::json fields = nlohmann::json::array();
        std::string ferr;
        if (db.query("SELECT field_id, form_id, field_key, field_label, field_type, is_required, "
                     "options, default_value, placeholder, validation, is_visible, is_editable, "
                     "remark, sort_order FROM form_field WHERE form_id = ? AND is_deleted = 0 "
                     "ORDER BY sort_order, field_id;",
                     nlohmann::json::array({f.value("form_id", 0)}), fields, ferr) == SQLITE_OK) {
          form["fields"] = std::move(fields);
        } else {
          form["fields"] = nlohmann::json::array();
        }
        forms.push_back(std::move(form));
      }
    }
  }
  detail["forms"] = std::move(forms);
  return detail;
}

} // namespace

nlohmann::json activity_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限创建活动");

  if (const nlohmann::json* e = validateBase(args)) return *e;
  const std::int64_t now = now_ts();
  const std::int64_t activity_type = cfg_int(args, "activity_type", 0);
  const std::int64_t start = cfg_int(args, "start_time", 0);
  const std::int64_t end = cfg_int(args, "end_time", 0);

  // 活动管理员必须至少绑定一个授权分组，否则创建后不可见（config.md 1.2）
  std::vector<std::int64_t> group_ids;
  if (args.contains("group_ids") && args["group_ids"].is_array()) {
    for (const auto& g : args["group_ids"]) {
      if (g.is_number_integer()) group_ids.push_back(g.get<std::int64_t>());
    }
  }
  if (!is_super_admin(db, uid) && group_ids.empty()) {
    return cfg_err(kValidation, "请至少绑定一个授权分组");
  }
  for (const std::int64_t gid : group_ids) {
    if (!group_exists(db, gid, false)) return cfg_err(kNotFound, "分组不存在");
    if (!group_in_scope(db, uid, 2, gid)) return cfg_err(kForbidden, "分组不在授权范围内");
  }

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  if (db.execParams("INSERT INTO activity (name, description, activity_type, start_time, end_time, "
                    "max_slots, status, need_review, allow_modify, is_deleted, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?);",
                    nlohmann::json::array(
                        {cfg_str(args, "name"), cfg_str(args, "description"), activity_type, start,
                         end, cfg_int(args, "max_slots", 0), cfg_bool(args, "need_review", false),
                         cfg_bool(args, "allow_modify", false), now})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "insert activity failed: " + db.lastError());
  }
  const std::int64_t activity_id = db.lastInsertRowid();
  for (const std::int64_t gid : group_ids) {
    if (db.execParams("INSERT OR IGNORE INTO activity_group (activity_id, group_id) VALUES (?, ?);",
                      nlohmann::json::array({activity_id, gid})) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "bind group failed: " + db.lastError());
    }
  }
  if (db.commit() != SQLITE_OK) return cfg_err(kDbError, "commit failed");

  audit_log(db, uid, "create_activity", "activity:" + std::to_string(activity_id),
            {{"name", cfg_str(args, "name")}, {"group_ids", group_ids}});
  return cfg_ok({{"activity_id", activity_id}});
}

nlohmann::json activity_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json row;
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限操作该活动");

  if (const nlohmann::json* e = validateBase(args)) return *e;

  // 状态流转校验（config.md 3.1 转移表）
  const int from = row.value("status", 0);
  int to = from;
  if (args.contains("status")) to = static_cast<int>(cfg_int(args, "status", from));
  if (to < 0 || to > 3) return cfg_err(kValidation, "status 须为 0~3");
  const std::int64_t end_time =
      args.contains("end_time") ? cfg_int(args, "end_time", 0) : row.value("end_time", 0);
  if (!valid_status_transition(from, to, end_time, now_ts())) {
    return cfg_err(kConflict, "非法的活动状态流转");
  }

  // 收集变更字段（before/after 审计）
  nlohmann::json detail_before = nlohmann::json::object();
  nlohmann::json detail_after = nlohmann::json::object();
  const char* int_keys[] = {"activity_type", "start_time", "end_time",
                            "max_slots",     "need_review", "allow_modify"};
  if (args.contains("status")) {
    detail_before["status"] = from;
    detail_after["status"] = to;
  }
  for (const char* key : int_keys) {
    if (!args.contains(key)) continue;
    const std::int64_t v = cfg_int(args, key, 0);
    if (row.value(key, 0) != v) {
      detail_before[key] = row.value(key, 0);
      detail_after[key] = v;
    }
  }
  for (const char* key : {"name", "description"}) {
    if (!args.contains(key)) continue;
    const std::string v = cfg_str(args, key);
    if (row.value(key, "") != v) {
      detail_before[key] = row.value(key, "");
      detail_after[key] = v;
    }
  }

  // 未提供字段回退当前值（UPDATE 覆盖全部业务列）
  const auto fallback_str = [&](const char* key, const std::string& cur) {
    return args.contains(key) ? cfg_str(args, key) : cur;
  };
  const auto fallback_int = [&](const char* key, std::int64_t cur) {
    return args.contains(key) ? cfg_int(args, key, cur) : cur;
  };

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  if (db.execParams("UPDATE activity SET name = ?, description = ?, activity_type = ?, "
                    "start_time = ?, end_time = ?, max_slots = ?, need_review = ?, "
                    "allow_modify = ?, status = ? WHERE activity_id = ?;",
                    nlohmann::json::array(
                        {fallback_str("name", row.value("name", "")),
                         fallback_str("description", row.value("description", "")),
                         fallback_int("activity_type", row.value("activity_type", 0)),
                         fallback_int("start_time", row.value("start_time", 0)),
                         fallback_int("end_time", row.value("end_time", 0)),
                         fallback_int("max_slots", row.value("max_slots", 0)),
                         fallback_int("need_review", row.value("need_review", 0)),
                         fallback_int("allow_modify", row.value("allow_modify", 0)), to,
                         activity_id})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "update activity failed: " + db.lastError());
  }
  if (db.commit() != SQLITE_OK) return cfg_err(kDbError, "commit failed");

  audit_log(db, uid, "update_activity", "activity:" + std::to_string(activity_id),
            {{"before", detail_before}, {"after", detail_after}});
  return cfg_ok({{"activity_id", activity_id}});
}

nlohmann::json activity_detail(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json row;
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (!can_read_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限查看该活动");
  return cfg_ok(buildDetail(db, row));
}

nlohmann::json activity_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!has_any_admin_role(db, uid)) return cfg_err(kForbidden, "无权限查看活动列表");

  const std::int64_t page = std::max<std::int64_t>(cfg_int(args, "page", 1), 1);
  const std::int64_t page_size =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "page_size", 10), 1), 100);
  const bool include_deleted = cfg_bool(args, "include_deleted", false);
  const bool super_admin = is_super_admin(db, uid);
  // 全范围：超管 或 存在 group_id IS NULL 的授权（role 2/3）
  bool all_scope = super_admin;
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM user_role WHERE uid = ? AND role_id IN (2,3) "
                 "AND group_id IS NULL LIMIT 1;",
                 nlohmann::json::array({uid}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      all_scope = true;
    }
  }

  // 基础 FROM：全范围直查；否则按授权分组（role 2/3）子树过滤（DISTINCT 防多分组重复行）
  std::string from;
  nlohmann::json params = nlohmann::json::array();
  if (all_scope) {
    from = "SELECT DISTINCT a.* FROM activity a";
  } else {
    from =
        "WITH RECURSIVE scope(gid) AS ("
        "  SELECT ur.group_id FROM user_role ur WHERE ur.uid = ? AND ur.role_id IN (2,3) "
        "    AND ur.group_id IS NOT NULL "
        "  UNION ALL "
        "  SELECT g.group_id FROM \"group\" g JOIN scope s ON g.parent_id = s.gid "
        "    AND g.is_deleted = 0 "
        ") "
        "SELECT DISTINCT a.* FROM activity a "
        "JOIN activity_group ag ON ag.activity_id = a.activity_id "
        "JOIN scope s ON ag.group_id = s.gid";
    params.push_back(uid);
  }
  std::vector<std::string> conds;
  if (!include_deleted) conds.push_back("a.is_deleted = 0");
  if (args.contains("status") && cfg_int(args, "status", -1) >= 0) {
    conds.push_back("a.status = ?");
    params.push_back(cfg_int(args, "status", 0));
  }
  if (args.contains("activity_type") && cfg_int(args, "activity_type", -1) >= 0) {
    conds.push_back("a.activity_type = ?");
    params.push_back(cfg_int(args, "activity_type", 0));
  }
  const std::string keyword = cfg_str(args, "keyword");
  if (!keyword.empty()) {
    conds.push_back("a.name LIKE ?");
    params.push_back("%" + keyword + "%");
  }
  const std::string where =
      conds.empty() ? "" : " WHERE " + [&] {
        std::string s;
        for (std::size_t i = 0; i < conds.size(); ++i) {
          if (i) s += " AND ";
          s += conds[i];
        }
        return s;
      }();

  nlohmann::json count_rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM (" + from + where + ") t;", params, count_rows,
               qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "count failed: " + qerr);
  }
  const std::int64_t total = count_rows.empty() ? 0 : count_rows[0].value("c", 0);

  nlohmann::json rows;
  nlohmann::json list_params = params;
  list_params.push_back(page_size);
  list_params.push_back((page - 1) * page_size);
  if (db.query(from + where + " ORDER BY a.created_at DESC, a.activity_id DESC LIMIT ? OFFSET ?;",
               list_params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "list failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

nlohmann::json activity_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json row;
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限删除该活动");
  if (row.value("status", 0) != 0) {
    return cfg_err(kConflict, "仅草稿状态可删除，请先截止或结束活动");
  }
  if (db.execParams("UPDATE activity SET is_deleted = 1 WHERE activity_id = ?;",
                    nlohmann::json::array({activity_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "delete_activity", "activity:" + std::to_string(activity_id),
            {{"name", row.value("name", "")}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json activity_public_list(Db& db, const nlohmann::json& args) {
  // 报名端：仅进行中且未过期（config.md 3.1）；M5 B2：分组筛选 + 名额进度 + 分页
  const std::int64_t now = now_ts();
  const std::int64_t page = std::max<std::int64_t>(cfg_int(args, "page", 1), 1);
  const std::int64_t page_size =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "page_size", 50), 1), 100);
  nlohmann::json params = nlohmann::json::array();
  std::string where =
      "a.status = 1 AND a.is_deleted = 0 AND (a.start_time = 0 OR a.start_time <= ?) "
      "AND (a.end_time = 0 OR a.end_time > ?)";
  params.push_back(now);
  params.push_back(now);
  if (args.contains("activity_type") && cfg_int(args, "activity_type", -1) >= 0) {
    where += " AND a.activity_type = ?";
    params.push_back(cfg_int(args, "activity_type", 0));
  }
  const std::string keyword = cfg_str(args, "keyword");
  if (!keyword.empty()) {
    where += " AND a.name LIKE ?";
    params.push_back("%" + keyword + "%");
  }
  // 分组筛选：选中分组及其全部子分组（嵌套树，仅未软删）
  if (cfg_int(args, "group_id", 0) > 0) {
    where +=
        " AND EXISTS ("
        "  WITH RECURSIVE sub(gid) AS ("
        "    SELECT ?"
        "    UNION ALL"
        "    SELECT g.group_id FROM \"group\" g JOIN sub s ON g.parent_id = s.gid"
        "      AND g.is_deleted = 0"
        "  )"
        "  SELECT 1 FROM activity_group ag JOIN sub s ON ag.group_id = s.gid"
        "  WHERE ag.activity_id = a.activity_id"
        ")";
    params.push_back(cfg_int(args, "group_id", 0));
  }

  nlohmann::json count_rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM activity a WHERE " + where + ";", params, count_rows,
               qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "count failed: " + qerr);
  }
  const std::int64_t total = count_rows.empty() ? 0 : count_rows[0].value("c", 0);

  nlohmann::json rows;
  nlohmann::json list_params = params;
  list_params.push_back(page_size);
  list_params.push_back((page - 1) * page_size);
  if (db.query(
          "SELECT a.activity_id, a.name, a.description, a.activity_type, a.start_time, a.end_time, "
          "a.max_slots, a.need_review, a.allow_modify, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id "
          "  AND r.status IN (1, 2)) AS taken "
          "FROM activity a WHERE " + where + " ORDER BY a.start_time DESC, a.activity_id DESC "
          "LIMIT ? OFFSET ?;",
          list_params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

nlohmann::json activity_public_detail(Db& db, const nlohmann::json& args) {
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json row;
  // 已发布（status >= 1）均可查看，报名仅限进行中（见 public_list）
  if (!activity_row(db, activity_id, false, row)) return cfg_err(kNotFound, "活动不存在");
  if (row.value("status", 0) < 1) return cfg_err(kNotFound, "活动未发布");
  nlohmann::json data = publicActivity(row);
  // 已占名额（与 public_list 口径一致：status IN (1,2)）
  nlohmann::json taken_rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM registration WHERE activity_id = ? AND status IN (1,2);",
               nlohmann::json::array({activity_id}), taken_rows, qerr) == SQLITE_OK &&
      !taken_rows.empty()) {
    data["taken"] = taken_rows[0].value("c", 0);
  } else {
    data["taken"] = 0;
  }
  // M5 B1：对齐 config.md 2.2 契约，公开详情补齐表单字段定义（供报名渲染 / 只读预览）
  nlohmann::json detail = buildDetail(db, row);
  data["groups"] = detail["groups"];
  data["forms"] = detail["forms"];
  return cfg_ok(std::move(data));
}

} // namespace sacc
