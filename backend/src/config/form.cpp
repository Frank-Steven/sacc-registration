#include "config/form.h"

#include <cctype>
#include <sqlite3.h>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {

// field_key：小写字母开头，字母/数字/下划线，长度 2~32（config.md 3.3）
bool validFieldKey(const std::string& k) {
  if (k.size() < 2 || k.size() > 32) return false;
  if (!std::islower(static_cast<unsigned char>(k[0]))) return false;
  for (const char c : k) {
    if (!(std::islower(static_cast<unsigned char>(c)) ||
          std::isdigit(static_cast<unsigned char>(c)) || c == '_')) {
      return false;
    }
  }
  return true;
}

// options / validation 必须为合法 JSON；options 对单选/多选须为非空数组
const nlohmann::json* validateFieldJson(const nlohmann::json& args) {
  if (args.contains("options") && !cfg_str(args, "options").empty()) {
    nlohmann::json v;
    if (!json_parse_lenient(cfg_str(args, "options"), v)) {
      static const nlohmann::json err = cfg_err(kValidation, "options 不是合法 JSON");
      return &err;
    }
    if (!v.is_array() || v.empty()) {
      static const nlohmann::json err =
          cfg_err(kValidation, "options 须为非空 JSON 数组");
      return &err;
    }
  }
  if (args.contains("validation") && !cfg_str(args, "validation").empty()) {
    nlohmann::json v;
    if (!json_parse_lenient(cfg_str(args, "validation"), v)) {
      static const nlohmann::json err = cfg_err(kValidation, "validation 不是合法 JSON");
      return &err;
    }
    if (!v.is_object()) {
      static const nlohmann::json err = cfg_err(kValidation, "validation 须为 JSON 对象");
      return &err;
    }
  }
  return nullptr;
}

// 加载表单所在活动行（校验权限用）
bool form_activity_row(Db& db, std::int64_t form_id, nlohmann::json& out_activity) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT a.* FROM form f JOIN activity a ON a.activity_id = f.activity_id "
               "WHERE f.form_id = ? AND f.is_deleted = 0 AND a.is_deleted = 0 LIMIT 1;",
               nlohmann::json::array({form_id}), rows, qerr) != SQLITE_OK) {
    return false;
  }
  if (rows.empty()) return false;
  out_activity = std::move(rows[0]);
  return true;
}

// 表单详情（表单 + 字段列表）
nlohmann::json buildFormDetail(Db& db, const nlohmann::json& form) {
  nlohmann::json fields = nlohmann::json::array();
  std::string qerr;
  if (db.query("SELECT field_id, form_id, field_key, field_label, field_type, is_required, "
               "options, default_value, placeholder, validation, is_visible, is_editable, "
               "remark, sort_order FROM form_field WHERE form_id = ? AND is_deleted = 0 "
               "ORDER BY sort_order, field_id;",
               nlohmann::json::array({form.value("form_id", 0)}), fields, qerr) != SQLITE_OK) {
    fields = nlohmann::json::array();
  }
  return {{"form", form}, {"fields", std::move(fields)}};
}

} // namespace

nlohmann::json form_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  if (!can_manage_activity(db, uid, activity_id)) return cfg_err(kForbidden, "无权限操作该活动");
  if (db.execParams("INSERT INTO form (activity_id, name, sort_order, is_required, is_deleted, "
                    "created_at) VALUES (?, ?, ?, ?, 0, ?);",
                    nlohmann::json::array({activity_id, cfg_str(args, "name"),
                                           cfg_int(args, "sort_order", 0),
                                           cfg_bool(args, "is_required", false), now_ts()})) !=
      SQLITE_OK) {
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t form_id = db.lastInsertRowid();
  audit_log(db, uid, "create_form", "form:" + std::to_string(form_id),
            {{"activity_id", activity_id}, {"name", cfg_str(args, "name")}});
  return cfg_ok({{"form_id", form_id}});
}

nlohmann::json form_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t form_id = cfg_int(args, "form_id", 0);
  nlohmann::json form;
  if (!form_row(db, form_id, false, form)) return cfg_err(kNotFound, "表单不存在");
  nlohmann::json act;
  if (!form_activity_row(db, form_id, act)) return cfg_err(kNotFound, "表单不存在");
  if (!can_manage_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限操作该表单");
  }
  if (db.execParams("UPDATE form SET name = ?, sort_order = ?, is_required = ? WHERE form_id = ?;",
                    nlohmann::json::array(
                        {args.contains("name") ? cfg_str(args, "name") : form.value("name", ""),
                         cfg_int(args, "sort_order", form.value("sort_order", 0)),
                         cfg_bool(args, "is_required", form.value("is_required", 0) != 0),
                         form_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "update_form", "form:" + std::to_string(form_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json form_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t form_id = cfg_int(args, "form_id", 0);
  nlohmann::json form;
  if (!form_row(db, form_id, false, form)) return cfg_err(kNotFound, "表单不存在");
  nlohmann::json act;
  if (!form_activity_row(db, form_id, act)) return cfg_err(kNotFound, "表单不存在");
  if (!can_manage_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限删除该表单");
  }
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM form_field WHERE form_id = ? AND is_deleted = 0 LIMIT 1;",
                 nlohmann::json::array({form_id}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      return cfg_err(kConflict, "表单下仍有字段，请先删除字段");
    }
  }
  if (db.execParams("UPDATE form SET is_deleted = 1 WHERE form_id = ?;",
                    nlohmann::json::array({form_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "delete_form", "form:" + std::to_string(form_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json form_detail(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t form_id = cfg_int(args, "form_id", 0);
  nlohmann::json form;
  if (!form_row(db, form_id, false, form)) return cfg_err(kNotFound, "表单不存在");
  nlohmann::json act;
  if (!form_activity_row(db, form_id, act)) return cfg_err(kNotFound, "表单不存在");
  if (!can_read_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限查看该表单");
  }
  return cfg_ok(buildFormDetail(db, form));
}

nlohmann::json form_field_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t form_id = cfg_int(args, "form_id", 0);
  nlohmann::json form;
  if (!form_row(db, form_id, false, form)) return cfg_err(kNotFound, "表单不存在");
  nlohmann::json act;
  if (!form_activity_row(db, form_id, act)) return cfg_err(kNotFound, "表单不存在");
  if (!can_manage_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限操作该表单");
  }

  const std::string field_key = cfg_str(args, "field_key");
  const std::string field_label = cfg_str(args, "field_label");
  const std::int64_t field_type = cfg_int(args, "field_type", 0);
  if (!validFieldKey(field_key)) return cfg_err(kValidation, "field_key 不合法（小写字母开头 2~32 位）");
  if (field_label.empty()) return cfg_err(kValidation, "field_label 不能为空");
  if (field_type < 0 || field_type > 5) return cfg_err(kValidation, "field_type 须为 0~5");
  if (const nlohmann::json* e = validateFieldJson(args)) return *e;
  if ((field_type == 2 || field_type == 3) && cfg_str(args, "options").empty()) {
    return cfg_err(kValidation, "单选/多选字段必须提供 options");
  }
  {
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM form_field WHERE form_id = ? AND field_key = ? "
                 "AND is_deleted = 0 LIMIT 1;",
                 nlohmann::json::array({form_id, field_key}), rows, qerr) == SQLITE_OK &&
        !rows.empty()) {
      return cfg_err(kConflict, "字段 key 已存在");
    }
  }
  if (db.execParams(
          "INSERT INTO form_field (form_id, field_key, field_label, field_type, is_required, "
          "options, default_value, placeholder, validation, is_visible, is_editable, is_deleted, "
          "remark, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);",
          nlohmann::json::array(
              {form_id, field_key, field_label, field_type, cfg_bool(args, "is_required", false),
               cfg_str(args, "options"), cfg_str(args, "default_value"), cfg_str(args, "placeholder"),
               cfg_str(args, "validation"), cfg_bool(args, "is_visible", true),
               cfg_bool(args, "is_editable", true), cfg_str(args, "remark"),
               cfg_int(args, "sort_order", 0), now_ts()})) != SQLITE_OK) {
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t field_id = db.lastInsertRowid();
  audit_log(db, uid, "create_form_field", "field:" + std::to_string(field_id),
            {{"form_id", form_id}, {"field_key", field_key}, {"field_type", field_type}});
  return cfg_ok({{"field_id", field_id}});
}

nlohmann::json form_field_update(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t field_id = cfg_int(args, "field_id", 0);
  nlohmann::json field;
  if (!field_row(db, field_id, false, field)) return cfg_err(kNotFound, "字段不存在");
  nlohmann::json act;
  if (!form_activity_row(db, field.value("form_id", 0), act)) {
    return cfg_err(kNotFound, "表单不存在");
  }
  if (!can_manage_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限操作该字段");
  }

  // 冻结项：field_key / field_type 不可变更（config.md 3.3）
  if (args.contains("field_key") && cfg_str(args, "field_key") != field.value("field_key", "")) {
    return cfg_err(kConflict, "field_key 不可变更");
  }
  if (args.contains("field_type") && cfg_int(args, "field_type", -1) != field.value("field_type", 0)) {
    return cfg_err(kConflict, "field_type 不可变更");
  }
  if (const nlohmann::json* e = validateFieldJson(args)) return *e;

  // options：活动进行中（status >= 1）仅允许追加（config.md 3.3）
  if (args.contains("options")) {
    const std::string new_opts = cfg_str(args, "options");
    const int status = act.value("status", 0);
    if (status >= 1 && !field.value("options", "").empty()) {
      nlohmann::json old_arr, new_arr;
      if (!json_parse_lenient(field.value("options", "[]"), old_arr) ||
          !json_parse_lenient(new_opts, new_arr)) {
        return cfg_err(kValidation, "options 不是合法 JSON");
      }
      if (!new_arr.is_array()) return cfg_err(kValidation, "options 须为 JSON 数组");
      for (const auto& o : old_arr) {
        bool keep = false;
        for (const auto& n : new_arr) {
          if (n == o) {
            keep = true;
            break;
          }
        }
        if (!keep) return cfg_err(kConflict, "活动进行中仅允许追加选项，不可删除");
      }
    }
  }

  // 构建 UPDATE（仅含提供的字段）
  std::string sql = "UPDATE form_field SET ";
  nlohmann::json params = nlohmann::json::array();
  const char* str_keys[] = {"field_label", "default_value", "placeholder", "validation",
                            "remark",      "options"};
  const char* int_keys[] = {"is_required", "is_visible", "is_editable", "sort_order"};
  for (const char* key : str_keys) {
    if (!args.contains(key)) continue;
    sql += std::string(key) + " = ?, ";
    params.push_back(cfg_str(args, key));
  }
  for (const char* key : int_keys) {
    if (!args.contains(key)) continue;
    sql += std::string(key) + " = ?, ";
    params.push_back(cfg_int(args, key, 0));
  }
  if (params.empty()) return cfg_ok({{"ok", true}});
  sql.resize(sql.size() - 2);
  sql += " WHERE field_id = ?;";
  params.push_back(field_id);
  if (db.execParams(sql, params) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "update_form_field", "field:" + std::to_string(field_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

nlohmann::json form_field_delete(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t field_id = cfg_int(args, "field_id", 0);
  nlohmann::json field;
  if (!field_row(db, field_id, false, field)) return cfg_err(kNotFound, "字段不存在");
  nlohmann::json act;
  if (!form_activity_row(db, field.value("form_id", 0), act)) {
    return cfg_err(kNotFound, "表单不存在");
  }
  if (!can_manage_activity(db, uid, act.value("activity_id", 0))) {
    return cfg_err(kForbidden, "无权限删除该字段");
  }
  if (db.execParams("UPDATE form_field SET is_deleted = 1 WHERE field_id = ?;",
                    nlohmann::json::array({field_id})) != SQLITE_OK) {
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  audit_log(db, uid, "delete_form_field", "field:" + std::to_string(field_id), {{"ok", true}});
  return cfg_ok({{"ok", true}});
}

} // namespace sacc
