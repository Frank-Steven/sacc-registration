#include "data/export.h"

#include <map>
#include <sqlite3.h>
#include <string>
#include <vector>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"

namespace sacc {

namespace {
constexpr std::int64_t kMaxExportLimit = 5000;
constexpr std::int64_t kMaxCsvRows = 10000;
constexpr std::int64_t kMaxTrendDays = 90;

// 固定列（导出列序；export.md 2.2）
struct FixedCol {
  const char* key;
  const char* label;
};
const FixedCol kFixedCols[] = {
    {"registration_id", "报名ID"}, {"receipt_no", "凭证号"}, {"name", "姓名"},
    {"phone", "手机号"},           {"email", "邮箱"},       {"status", "状态"},
    {"queue_no", "候补序号"},      {"checkin_time", "签到时间"}, {"created_at", "报名时间"},
};
constexpr std::size_t kFixedColCount = sizeof(kFixedCols) / sizeof(kFixedCols[0]);

// 活动表单可见字段（is_deleted=0 AND is_visible=1，跨多表单按步骤/字段排序）
bool visible_fields(Db& db, std::int64_t activity_id, nlohmann::json& out) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT f.field_id, f.field_key, f.field_label, f.field_type, f.options "
               "FROM form_field f JOIN form fm ON f.form_id = fm.form_id "
               "WHERE fm.activity_id = ? AND fm.is_deleted = 0 AND f.is_deleted = 0 "
               "AND f.is_visible = 1 ORDER BY fm.sort_order, f.sort_order, f.field_id;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK) {
    return false;
  }
  out = std::move(rows);
  return true;
}

// options（JSON 数组）→ {value: label}；对象取 label、字符串取自身；容错旧数据
nlohmann::json build_option_map(const std::string& options_json) {
  nlohmann::json map = nlohmann::json::object();
  nlohmann::json opts;
  if (options_json.empty() || !json_parse_lenient(options_json, opts) || !opts.is_array()) {
    return map;
  }
  for (const auto& o : opts) {
    if (o.is_object()) {
      const std::string v = o.value("value", "");
      const std::string l = o.value("label", v);
      if (!v.empty()) map[v] = l;
    } else if (o.is_string()) {
      const std::string s = o.get<std::string>();
      map[s] = s;
    }
  }
  return map;
}

// 字段值 → 展示文本：单选/多选映射选项标签（多选以 ";" 连接），其余原样
std::string display_value(int field_type, const std::string& value, const nlohmann::json& opt_map) {
  if (field_type == 2) {
    if (opt_map.is_object() && opt_map.contains(value) && opt_map[value].is_string()) {
      return opt_map[value].get<std::string>();
    }
    return value;
  }
  if (field_type == 3) {
    nlohmann::json arr;
    if (json_parse_lenient(value, arr) && arr.is_array()) {
      std::string out;
      for (const auto& v : arr) {
        const std::string s = v.is_string() ? v.get<std::string>() : v.dump();
        std::string label = s;
        if (opt_map.is_object() && opt_map.contains(s) && opt_map[s].is_string()) {
          label = opt_map[s].get<std::string>();
        }
        if (!out.empty()) out += ";";
        out += label;
      }
      return out;
    }
    return value;
  }
  return value;
}

// 转义 LIKE 通配符（% _ \）：复用 core/util.h 的 escape_like（注册列表 / 导出过滤共用，深化审查 D3）

// 导出过滤条件（activity_id 恒在；status/keyword/created_from/created_to 可选）
std::string export_conditions(const nlohmann::json& args, std::int64_t activity_id,
                              nlohmann::json& params) {
  std::vector<std::string> conds;
  conds.push_back("r.activity_id = ?");
  params.push_back(activity_id);
  const std::int64_t status = cfg_int(args, "status", -1);
  if (status >= 0 && status <= 5) {
    conds.push_back("r.status = ?");
    params.push_back(status);
  }
  const std::string kw = cfg_str(args, "keyword");
  if (!kw.empty()) {
    const std::string esc = escape_like(kw);
    conds.push_back("(u.name LIKE ? ESCAPE '\\' OR r.receipt_no LIKE ? ESCAPE '\\')");
    params.push_back("%" + esc + "%");
    params.push_back("%" + esc + "%");
  }
  const std::int64_t from = cfg_int(args, "created_from", 0);
  const std::int64_t to = cfg_int(args, "created_to", 0);
  if (from > 0) {
    conds.push_back("r.created_at >= ?");
    params.push_back(from);
  }
  if (to > 0) {
    conds.push_back("r.created_at <= ?");
    params.push_back(to);
  }
  std::string where;
  for (std::size_t i = 0; i < conds.size(); ++i) {
    if (i > 0) where += " AND ";
    where += conds[i];
  }
  return where;
}

// 总行数（与主查询同条件）
std::int64_t export_total(Db& db, const nlohmann::json& args, std::int64_t activity_id) {
  nlohmann::json params;
  const std::string where = export_conditions(args, activity_id, params);
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM registration r JOIN \"user\" u ON r.uid = u.uid "
               "WHERE " + where + ";",
               params, rows, qerr) != SQLITE_OK || rows.empty()) {
    return -1;
  }
  return rows[0].value("c", 0);
}

// 单块导出：columns（固定列 + 动态列）+ rows（固定列值 + fields 对象）
// cursor = 上一块末尾 registration_id（首块 0），按 id 递增稳定排序（决策 1）
nlohmann::json export_page(Db& db, std::int64_t activity_id, const nlohmann::json& args,
                           std::int64_t cursor, std::int64_t limit) {
  nlohmann::json dyn;
  if (!visible_fields(db, activity_id, dyn)) return nlohmann::json();
  // 动态列元数据：field_id -> {field_key, field_type, options}
  std::map<std::int64_t, nlohmann::json> meta;
  for (const auto& f : dyn) {
    meta[f.value("field_id", 0)] =
        nlohmann::json{{"key", f.value("field_key", "")},
                       {"type", f.value("field_type", 0)},
                       {"opts", build_option_map(f.value("options", ""))}};
  }

  nlohmann::json params;
  const std::string where = export_conditions(args, activity_id, params);
  params.push_back(cursor);
  params.push_back(limit + 1);  // 多取 1 行探测是否还有下一页（恰好 limit 行也可能是末页）
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT r.registration_id, r.receipt_no, r.status, r.queue_no, r.checkin_time, "
               "r.created_at, u.name, u.phone, u.email "
               "FROM registration r JOIN \"user\" u ON r.uid = u.uid "
               "WHERE " + where + " AND r.registration_id > ? "
               "ORDER BY r.registration_id LIMIT ?;",
               params, rows, qerr) != SQLITE_OK) {
    return nlohmann::json();
  }
  const bool has_more = static_cast<std::int64_t>(rows.size()) > limit;
  const std::size_t page_size = static_cast<std::size_t>(limit);  // 探测行不参与装配

  // 块内行字段值（一次 IN 查询，走 idx_registration_data_reg）
  std::map<std::int64_t, nlohmann::json> values;  // registration_id -> {field_id: label}
  if (!rows.empty()) {
    std::string in_clause;
    nlohmann::json id_params;
    for (std::size_t i = 0; i < page_size && i < rows.size(); ++i) {
      if (i > 0) in_clause += ",";
      in_clause += "?";
      id_params.push_back(rows[i]["registration_id"].get<std::int64_t>());
    }
    nlohmann::json data_rows;
    if (db.query("SELECT registration_id, field_id, field_value FROM registration_data "
                 "WHERE registration_id IN (" + in_clause + ");",
                 id_params, data_rows, qerr) == SQLITE_OK) {
      for (const auto& d : data_rows) {
        const std::int64_t rid = d.value("registration_id", 0);
        const std::int64_t fid = d.value("field_id", 0);
        const auto it = meta.find(fid);
        if (it == meta.end()) continue;  // 字段已软删/隐藏：值不导出（库内保留）
        std::string label = display_value(it->second.value("type", 0),
                                          d.value("field_value", ""), it->second["opts"]);
        values[rid][it->second["key"].get<std::string>()] = std::move(label);
      }
    }
  }

  // 装配输出行（仅本页 page_size 行，探测行不输出）
  nlohmann::json out_rows = nlohmann::json::array();
  for (std::size_t i = 0; i < page_size && i < rows.size(); ++i) {
    const auto& r = rows[i];
    nlohmann::json row = nlohmann::json::object();
    row["registration_id"] = r["registration_id"];
    row["receipt_no"] = r["receipt_no"];
    row["name"] = r["name"];
    row["phone"] = r["phone"];
    row["email"] = r["email"];
    row["status"] = r["status"];
    row["queue_no"] = (r.contains("queue_no") && !r["queue_no"].is_null())
                          ? nlohmann::json(r["queue_no"].get<std::int64_t>())
                          : nlohmann::json(nullptr);
    row["checkin_time"] = (r.contains("checkin_time") && !r["checkin_time"].is_null())
                              ? nlohmann::json(r["checkin_time"].get<std::int64_t>())
                              : nlohmann::json(nullptr);
    row["created_at"] = r["created_at"];
    const std::int64_t rid = r["registration_id"].get<std::int64_t>();
    const auto vit = values.find(rid);
    row["fields"] = (vit != values.end()) ? vit->second : nlohmann::json::object();
    out_rows.push_back(std::move(row));
  }

  // 列定义
  nlohmann::json columns = nlohmann::json::array();
  for (std::size_t i = 0; i < kFixedColCount; ++i) {
    columns.push_back({{"key", kFixedCols[i].key}, {"label", kFixedCols[i].label}});
  }
  for (const auto& f : dyn) {
    columns.push_back(
        {{"key", f.value("field_key", "")}, {"label", f.value("field_label", "")}});
  }

  // 先算 next_cursor 再组装（nlohmann initializer_list 从左到右求值，先 move 会使 out_rows 变空）
  // 有下一页时取本页最后一行（rows[limit-1]，探测行在 page_size 之外）
  const std::int64_t next_cursor =
      has_more ? rows[limit - 1]["registration_id"].get<std::int64_t>() : 0;
  return nlohmann::json{
      {"columns", std::move(columns)},
      {"rows", std::move(out_rows)},
      {"next_cursor", next_cursor},
  };
}

// RFC 4180 转义（含逗号/引号/换行时加引号并双写引号）
std::string csv_escape(const std::string& s) {
  if (s.find_first_of(",\"\n\r") == std::string::npos) return s;
  std::string out = "\"";
  for (const char c : s) {
    if (c == '"') out += "\"\"";
    else out += c;
  }
  out += "\"";
  return out;
}

// 权限与活动存在性前置检查：manage=true 导出 / false 统计；返回空表示已写错误
nlohmann::json check_export_access(Db& db, const nlohmann::json& args, bool manage) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在");
  const bool ok = manage ? can_manage_activity(db, uid, activity_id)
                         : can_read_activity(db, uid, activity_id);
  if (!ok) return cfg_err(kForbidden, "无权限访问该活动");
  return nlohmann::json();
}
} // namespace

nlohmann::json registration_export(Db& db, const nlohmann::json& args) {
  const nlohmann::json denied = check_export_access(db, args, true);
  if (!denied.is_null()) return denied;
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::int64_t cursor = cfg_int(args, "cursor", 0);
  if (cursor < 0) return cfg_err(kValidation, "cursor 非法");
  const std::int64_t limit =
      std::max<std::int64_t>(1, std::min<std::int64_t>(cfg_int(args, "limit", 1000), kMaxExportLimit));
  const std::int64_t total = export_total(db, args, activity_id);
  if (total < 0) return cfg_err(kDbError, "导出统计失败");
  nlohmann::json page = export_page(db, activity_id, args, cursor, limit);
  if (page.is_null()) return cfg_err(kDbError, "导出失败");
  // 首块写审计（分块多次调用不刷屏）
  if (cursor == 0) {
    audit_log(db, cfg_int(args, "uid", 0), "export_registration",
              "registration:" + std::to_string(activity_id),
              {{"activity_id", activity_id}, {"kind", "json"}, {"rows", total}});
  }
  nlohmann::json data = {{"total", total}, {"next_cursor", page["next_cursor"]}};
  data["columns"] = std::move(page["columns"]);
  data["rows"] = std::move(page["rows"]);
  return cfg_ok(std::move(data));
}

nlohmann::json registration_export_csv(Db& db, const nlohmann::json& args) {
  const nlohmann::json denied = check_export_access(db, args, true);
  if (!denied.is_null()) return denied;
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::int64_t total = export_total(db, args, activity_id);
  if (total < 0) return cfg_err(kDbError, "导出统计失败");
  if (total > kMaxCsvRows) {
    return cfg_err(kValidation, "行数超过 CSV 单次导出上限（" + std::to_string(kMaxCsvRows) +
                                    "），请使用分块导出接口");
  }
  nlohmann::json page = export_page(db, activity_id, args, 0, kMaxCsvRows);
  if (page.is_null()) return cfg_err(kDbError, "导出失败");

  std::string csv = "\xEF\xBB\xBF";  // UTF-8 BOM（Excel 中文兼容）
  // 表头
  for (std::size_t i = 0; i < page["columns"].size(); ++i) {
    if (i > 0) csv += ",";
    csv += csv_escape(page["columns"][i].value("label", ""));
  }
  csv += "\n";
  // 数据行（列序与 columns 一致：固定列取行值，动态列取 fields）
  for (const auto& r : page["rows"]) {
    for (std::size_t i = 0; i < page["columns"].size(); ++i) {
      if (i > 0) csv += ",";
      const std::string key = page["columns"][i].value("key", "");
      bool fixed = false;
      for (std::size_t k = 0; k < kFixedColCount; ++k) {
        if (key == kFixedCols[k].key) {
          fixed = true;
          break;
        }
      }
      std::string val;
      if (fixed) {
        const auto it = r.find(key);
        if (it != r.end() && !it->is_null()) {
          val = it->is_string() ? it->get<std::string>() : it->dump();
        }
      } else if (r.contains("fields")) {
        const auto fit = r["fields"].find(key);
        if (fit != r["fields"].end() && fit->is_string()) val = fit->get<std::string>();
      }
      csv += csv_escape(val);
    }
    csv += "\n";
  }
  audit_log(db, cfg_int(args, "uid", 0), "export_registration",
            "registration:" + std::to_string(activity_id),
            {{"activity_id", activity_id}, {"kind", "csv"}, {"rows", total}});
  return cfg_ok({{"csv", std::move(csv)}, {"total", total}});
}

nlohmann::json registration_stats(Db& db, const nlohmann::json& args) {
  const nlohmann::json denied = check_export_access(db, args, false);
  if (!denied.is_null()) return denied;
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::string qid = std::to_string(activity_id);
  nlohmann::json rows;
  std::string qerr;

  // 状态分布（固定输出 6 态，缺失补 0）
  std::map<int, std::int64_t> dist;
  if (db.query("SELECT status, COUNT(*) AS c FROM registration WHERE activity_id = ? GROUP BY status;",
               nlohmann::json::array({activity_id}), rows, qerr) == SQLITE_OK) {
    for (const auto& r : rows) dist[r.value("status", 0)] = r.value("c", 0);
  }
  nlohmann::json status_dist = nlohmann::json::array();
  for (int s = 0; s <= 5; ++s) status_dist.push_back({{"status", s}, {"count", dist[s]}});

  // 名额 / 签到
  std::int64_t taken = 0, waitlist = 0, pending = 0, checked_in = 0;
  if (db.query("SELECT status, COUNT(*) AS c FROM registration WHERE activity_id = ? "
               "AND status IN (1,2,5) GROUP BY status;",
               nlohmann::json::array({activity_id}), rows, qerr) == SQLITE_OK) {
    for (const auto& r : rows) {
      const int s = r.value("status", 0);
      if (s == 1) { taken += r.value("c", 0); pending += r.value("c", 0); }
      else if (s == 2) taken += r.value("c", 0);
      else if (s == 5) waitlist += r.value("c", 0);
    }
  }
  if (db.query("SELECT COUNT(*) AS c FROM registration WHERE activity_id = ? "
               "AND checkin_time IS NOT NULL;",
               nlohmann::json::array({activity_id}), rows, qerr) == SQLITE_OK && !rows.empty()) {
    checked_in = rows[0].value("c", 0);
  }
  nlohmann::json act;
  activity_row(db, activity_id, false, act);
  const std::int64_t capacity = act.value("max_slots", 0);

  // 字段分布：可见单选(2)/多选(3) 字段按选项计数，口径 status IN (1,2,5)（决策 4）
  nlohmann::json dyn;
  nlohmann::json field_dist = nlohmann::json::array();
  if (visible_fields(db, activity_id, dyn)) {
    bool has_json1 = false;
    nlohmann::json crows;
    if (db.query("SELECT sqlite_compileoption_used('JSON1') AS ok;", nullptr, crows, qerr) ==
            SQLITE_OK &&
        !crows.empty()) {
      has_json1 = crows[0].value("ok", 0) == 1;
    }
    for (const auto& f : dyn) {
      const int ftype = f.value("field_type", 0);
      if (ftype != 2 && ftype != 3) continue;
      const std::int64_t fid = f.value("field_id", 0);
      const nlohmann::json opt_map = build_option_map(f.value("options", ""));
      std::map<std::string, std::int64_t> counts;
      if (ftype == 2) {
        if (db.query("SELECT d.field_value AS v, COUNT(*) AS c FROM registration_data d "
                     "JOIN registration r ON d.registration_id = r.registration_id "
                     "WHERE r.activity_id = ? AND d.field_id = ? AND r.status IN (1,2,5) "
                     "GROUP BY d.field_value;",
                     nlohmann::json::array({activity_id, fid}), rows, qerr) == SQLITE_OK) {
          for (const auto& r : rows) counts[r.value("v", "")] = r.value("c", 0);
        }
      } else if (has_json1) {
        // 多选 JSON 数组展开计数（SQLite JSON1）
        if (db.query("SELECT je.value AS v, COUNT(*) AS c FROM registration_data d "
                     "JOIN registration r ON d.registration_id = r.registration_id, "
                     "json_each(d.field_value) je "
                     "WHERE r.activity_id = ? AND d.field_id = ? AND r.status IN (1,2,5) "
                     "GROUP BY je.value;",
                     nlohmann::json::array({activity_id, fid}), rows, qerr) == SQLITE_OK) {
          for (const auto& r : rows) counts[r.value("v", "")] = r.value("c", 0);
        }
      } else {
        // 无 JSON1：wasm 内解析多选（量小）
        if (db.query("SELECT d.field_value AS v FROM registration_data d "
                     "JOIN registration r ON d.registration_id = r.registration_id "
                     "WHERE r.activity_id = ? AND d.field_id = ? AND r.status IN (1,2,5);",
                     nlohmann::json::array({activity_id, fid}), rows, qerr) == SQLITE_OK) {
          for (const auto& r : rows) {
            nlohmann::json arr;
            if (json_parse_lenient(r.value("v", ""), arr) && arr.is_array()) {
              for (const auto& v : arr) {
                if (v.is_string()) counts[v.get<std::string>()] += 1;
              }
            }
          }
        }
      }
      nlohmann::json items = nlohmann::json::array();
      for (const auto& kv : counts) {
        std::string label = kv.first;
        if (opt_map.is_object() && opt_map.contains(kv.first) && opt_map[kv.first].is_string()) {
          label = opt_map[kv.first].get<std::string>();
        }
        items.push_back({{"value", kv.first}, {"label", std::move(label)}, {"count", kv.second}});
      }
      field_dist.push_back({{"field_id", fid},
                            {"field_key", f.value("field_key", "")},
                            {"label", f.value("field_label", "")},
                            {"items", std::move(items)}});
    }
  }

  nlohmann::json data = {{"status_dist", std::move(status_dist)},
                         {"capacity", capacity},
                         {"taken", taken},
                         {"waitlist", waitlist},
                         {"pending", pending},
                         {"checked_in", checked_in},
                         {"field_dist", std::move(field_dist)}};
  return cfg_ok(std::move(data));
}

nlohmann::json registration_trend(Db& db, const nlohmann::json& args) {
  const nlohmann::json denied = check_export_access(db, args, false);
  if (!denied.is_null()) return denied;
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  const std::int64_t days =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "days", 7), 1), kMaxTrendDays);
  // 窗口含今天共 days 天：起点为 days-1 天前（序列 [今天-(days-1) .. 今天]）
  const std::string offset = "-" + std::to_string(days - 1) + " days";
  nlohmann::json seq_rows, cnt_rows;
  std::string qerr;
  // 连续日期序列（UTC；决策 8），再 LEFT 合并计数，缺失天补 0
  if (db.query("WITH RECURSIVE seq(d) AS (SELECT date('now', ?) "
               "UNION ALL SELECT date(d, '+1 day') FROM seq WHERE d < date('now')) "
               "SELECT d FROM seq;",
               nlohmann::json::array({offset}), seq_rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "趋势查询失败");
  }
  if (db.query("SELECT date(created_at, 'unixepoch') AS d, COUNT(*) AS c FROM registration "
               "WHERE activity_id = ? AND status IN (1,2,3,4,5) "
               "AND created_at >= strftime('%s', date('now', ?)) GROUP BY d;",
               nlohmann::json::array({activity_id, offset}), cnt_rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "趋势查询失败");
  }
  std::map<std::string, std::int64_t> cm;
  for (const auto& r : cnt_rows) cm[r.value("d", "")] = r.value("c", 0);
  nlohmann::json items = nlohmann::json::array();
  for (const auto& r : seq_rows) {
    const std::string d = r.value("d", "");
    items.push_back({{"date", d}, {"count", cm.count(d) ? cm[d] : 0}});
  }
  return cfg_ok({{"days", days}, {"items", std::move(items)}});
}

nlohmann::json activity_stats(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  if (!has_any_admin_role(db, uid)) return cfg_err(kForbidden, "无权限查看活动统计");
  const std::int64_t page = std::max<std::int64_t>(cfg_int(args, "page", 1), 1);
  const std::int64_t page_size =
      std::min<std::int64_t>(std::max<std::int64_t>(cfg_int(args, "page_size", 20), 1), 100);
  const bool super_admin = is_super_admin(db, uid);
  bool all_scope = super_admin;
  const std::int64_t group_id = cfg_int(args, "group_id", 0);
  {
    nlohmann::json rows;
    std::string qerr;
    if (group_id == 0 &&
        db.query("SELECT 1 FROM user_role WHERE uid = ? AND role_id IN (2,3) "
                 "AND group_id IS NULL LIMIT 1;",
                 nlohmann::json::array({uid}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      all_scope = true;
    }
  }

  // 范围：group_id 指定则取该分组子树；否则沿用授权范围（同 activity_list）
  std::string from;
  nlohmann::json params = nlohmann::json::array();
  if (group_id > 0) {
    from = "WITH RECURSIVE scope(gid) AS ("
           "  SELECT ? "
           "  UNION ALL "
           "  SELECT g.group_id FROM \"group\" g JOIN scope s ON g.parent_id = s.gid "
           "    AND g.is_deleted = 0 "
           ") "
           "SELECT DISTINCT a.* FROM activity a "
           "JOIN activity_group ag ON ag.activity_id = a.activity_id "
           "JOIN scope s ON ag.group_id = s.gid";
    params.push_back(group_id);
  } else if (all_scope) {
    from = "SELECT DISTINCT a.* FROM activity a";
  } else {
    from = "WITH RECURSIVE scope(gid) AS ("
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

  // 过滤：未软删 + keyword（名称）+ 报名窗口起止（start_time）
  std::vector<std::string> conds;
  conds.push_back("a.is_deleted = 0");
  const std::string kw = cfg_str(args, "keyword");
  if (!kw.empty()) {
    conds.push_back("a.name LIKE ? ESCAPE '\\'");
    params.push_back("%" + escape_like(kw) + "%");
  }
  const std::int64_t df = cfg_int(args, "date_from", 0);
  const std::int64_t dt = cfg_int(args, "date_to", 0);
  if (df > 0) {
    conds.push_back("a.start_time >= ?");
    params.push_back(df);
  }
  if (dt > 0) {
    conds.push_back("a.start_time <= ?");
    params.push_back(dt);
  }
  std::string where;
  for (std::size_t i = 0; i < conds.size(); ++i) {
    if (i > 0) where += " AND ";
    where += conds[i];
  }
  const std::string base = from + " WHERE " + where;

  nlohmann::json rows;
  std::string qerr;
  nlohmann::json cparams = params;
  std::int64_t total = 0;
  if (db.query("SELECT COUNT(*) AS c FROM (" + base + ") t;", cparams, rows, qerr) == SQLITE_OK &&
      !rows.empty()) {
    total = rows[0].value("c", 0);
  }
  nlohmann::json rparams = params;
  rparams.push_back(page_size);
  rparams.push_back((page - 1) * page_size);
  if (db.query(
          "SELECT a.activity_id, a.name, a.status, a.start_time, a.end_time, a.max_slots, "
          "a.need_review, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id) AS total, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id "
          " AND r.status IN (1,2)) AS taken, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id "
          " AND r.status = 1) AS pending, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id "
          " AND r.status = 5) AS waitlist, "
          "(SELECT COUNT(*) FROM registration r WHERE r.activity_id = a.activity_id "
          " AND r.checkin_time IS NOT NULL) AS checked_in "
          "FROM (" + base + ") a ORDER BY a.activity_id DESC LIMIT ? OFFSET ?;",
          rparams, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "活动统计查询失败");
  }
  return cfg_ok({{"total", total}, {"rows", std::move(rows)}});
}

} // namespace sacc
