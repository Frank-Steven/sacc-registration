#include "config/template.h"

#include <sqlite3.h>

#include "config/authz.h"
#include "core/util.h"

namespace sacc {

namespace {

constexpr int kForbidden = 403;
constexpr int kNotFound = 404;
constexpr int kValidation = 422;
constexpr int kDbError = 2001;

// fields_json 须为合法 JSON 数组（空数组 = 空表单快照）
const nlohmann::json* validateFieldsJson(const std::string& s) {
  if (s.empty()) return nullptr;
  nlohmann::json v;
  if (!json_parse_lenient(s, v)) {
    static const nlohmann::json err = cfg_err(kValidation, "fields_json 不是合法 JSON");
    return &err;
  }
  if (!v.is_array()) {
    static const nlohmann::json err = cfg_err(kValidation, "fields_json 须为 JSON 数组");
    return &err;
  }
  return nullptr;
}

} // namespace

nlohmann::json form_template_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限创建模板");
  const std::string name = cfg_str(args, "name");
  if (name.empty() || name.size() > 50) return cfg_err(kValidation, "模板名称须为 1~50 字符");
  const std::string fields_json = cfg_str(args, "fields_json");
  if (const nlohmann::json* e = validateFieldsJson(fields_json)) return *e;
  if (db.execParams("INSERT INTO form_template (name, description, fields_json, created_at) "
                    "VALUES (?, ?, ?, ?);",
                    nlohmann::json::array({name, cfg_str(args, "description"), fields_json,
                                           now_ts()})) != SQLITE_OK) {
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t template_id = db.lastInsertRowid();
  audit_log(db, uid, "create_form_template", "template:" + std::to_string(template_id),
            {{"name", name}});
  return cfg_ok({{"template_id", template_id}});
}

nlohmann::json form_template_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t template_id = cfg_int(args, "template_id", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限修改模板");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT * FROM form_template WHERE template_id = ? LIMIT 1;",
               nlohmann::json::array({template_id}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (rows.empty()) return cfg_err(kNotFound, "模板不存在");
  const std::string fields_json = cfg_str(args, "fields_json");
  if (const nlohmann::json* e = validateFieldsJson(fields_json)) return *e;
  const std::string name = cfg_str(args, "name");
  if (!name.empty() && name.size() > 50) return cfg_err(kValidation, "模板名称须为 1~50 字符");
  if (db.execParams("UPDATE form_template SET name = ?, description = ?, fields_json = ? "
                    "WHERE template_id = ?;",
                    nlohmann::json::array(
                        {name.empty() ? rows[0].value("name", "") : name,
                         args.contains("description") ? cfg_str(args, "description")
                                                      : rows[0].value("description", ""),
                         fields_json, template_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "update_form_template", "template:" + std::to_string(template_id),
            {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json form_template_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t template_id = cfg_int(args, "template_id", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限删除模板");
  if (db.execParams("DELETE FROM form_template WHERE template_id = ?;",
                    nlohmann::json::array({template_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "delete failed: " + db.lastError());
  }
  if (db.lastChanges() == 0) return cfg_err(kNotFound, "模板不存在");
  audit_log(db, uid, "delete_form_template", "template:" + std::to_string(template_id),
            {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json form_template_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限查看模板");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT template_id, name, description, fields_json, created_at "
               "FROM form_template ORDER BY template_id DESC;",
               nullptr, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}});
}

nlohmann::json form_template_save_from_activity(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限创建模板");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限操作该活动");
  const std::string name = cfg_str(args, "name");
  if (name.empty() || name.size() > 50) return cfg_err(kValidation, "模板名称须为 1~50 字符");

  // 按表单顺序收集未删字段生成快照（config.md 3.4：不含已删字段）
  nlohmann::json rows;
  std::string qerr;
  if (db.query(
          "SELECT f.name AS form_name, ff.field_key, ff.field_label, ff.field_type, "
          "ff.is_required, ff.options, ff.default_value, ff.placeholder, ff.validation, "
          "ff.is_visible, ff.is_editable, ff.remark, ff.sort_order "
          "FROM form f JOIN form_field ff ON ff.form_id = f.form_id "
          "WHERE f.activity_id = ? AND f.is_deleted = 0 AND ff.is_deleted = 0 "
          "ORDER BY f.sort_order, f.form_id, ff.sort_order, ff.field_id;",
          nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (db.execParams("INSERT INTO form_template (name, description, fields_json, created_at) "
                    "VALUES (?, ?, ?, ?);",
                    nlohmann::json::array({name, cfg_str(args, "description"), rows.dump(),
                                           now_ts()})) != SQLITE_OK) {
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t template_id = db.lastInsertRowid();
  audit_log(db, uid, "create_form_template", "template:" + std::to_string(template_id),
            {{"source_activity", activity_id}, {"name", name}});
  return cfg_ok({{"template_id", template_id}});
}

nlohmann::json form_template_apply(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t template_id = cfg_int(args, "template_id", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (!is_manager(db, uid)) return cfg_err(kForbidden, "无权限套用模板");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限操作该活动");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT * FROM form_template WHERE template_id = ? LIMIT 1;",
               nlohmann::json::array({template_id}), rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (rows.empty()) return cfg_err(kNotFound, "模板不存在");

  nlohmann::json fields = nlohmann::json::array();
  const std::string fields_json = rows[0].value("fields_json", "");
  nlohmann::json parsed;
  if (!fields_json.empty() && json_parse_lenient(fields_json, parsed) && parsed.is_array()) {
    fields = std::move(parsed);
  }

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  if (db.execParams("INSERT INTO form (activity_id, name, sort_order, is_required, is_deleted, "
                    "created_at) VALUES (?, '报名表', 0, 0, 0, ?);",
                    nlohmann::json::array({activity_id, now_ts()})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "insert form failed: " + db.lastError());
  }
  const std::int64_t form_id = db.lastInsertRowid();
  for (const auto& f : fields) {
    const std::string field_key = f.value("field_key", "");
    const std::int64_t field_type = f.value("field_type", 0);
    if (field_key.empty() || field_type < 0 || field_type > 5) continue;  // 跳过非法项
    if (db.execParams(
            "INSERT INTO form_field (form_id, field_key, field_label, field_type, is_required, "
            "options, default_value, placeholder, validation, is_visible, is_editable, "
            "is_deleted, remark, sort_order, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);",
            nlohmann::json::array(
                {form_id, field_key, f.value("field_label", ""), field_type,
                 f.value("is_required", 0), f.value("options", ""), f.value("default_value", ""),
                 f.value("placeholder", ""), f.value("validation", ""), f.value("is_visible", 1),
                 f.value("is_editable", 1), f.value("remark", ""), f.value("sort_order", 0),
                 now_ts()})) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "insert field failed: " + db.lastError());
    }
  }
  if (db.commit() != SQLITE_OK) return cfg_err(kDbError, "commit failed");

  audit_log(db, uid, "apply_form_template", "activity:" + std::to_string(activity_id),
            {{"template_id", template_id}, {"form_id", form_id}});
  return cfg_ok({{"form_id", form_id}});
}

} // namespace sacc
