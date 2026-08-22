#include "data/registration.h"

#include <algorithm>
#include <sqlite3.h>
#include <string>

#include "config/authz.h"
#include "core/errors.h"
#include "core/util.h"
#include "data/notification.h"
#include "data/validation.h"

namespace sacc {

namespace {

// 统一读取活动状态：行可能来自 activity_row（SELECT *，键为 status）或
// reg_with_activity（JOIN 用 a.status AS activity_status，避让 r.* 的报名状态 status 键）。
// 集中双键处理，避免散落各处随查询形态静默读错。
std::int64_t activity_status_of(const nlohmann::json& act) {
  if (act.contains("activity_status")) return act.value("activity_status", 0);
  return act.value("status", 0);
}

// 报名端可见：活动进行中（status==1）且未软删；时间窗口 [start_time, end_time)（0 表示不限）
bool in_apply_window(const nlohmann::json& act, std::int64_t now) {
  if (activity_status_of(act) != 1) return false;
  const std::int64_t s = act.value("start_time", 0);
  const std::int64_t e = act.value("end_time", 0);
  return (s == 0 || now >= s) && (e == 0 || now < e);
}

// 当前占用名额数（仅 status IN (1,2) 占名额，registration.md 二）；
// 查询失败返回 -1（不视为 0），避免 fail-open 放行报名
std::int64_t count_taken(Db& db, std::int64_t activity_id) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM registration WHERE activity_id = ? AND status IN (1,2);",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK || rows.empty()) {
    return -1;
  }
  return rows[0].value("c", 0);
}

// 活动是否有剩余名额（max_slots==0 不限）；占用数未知（-1）时保守判定无空位
bool slot_available(Db& db, const nlohmann::json& act, std::int64_t activity_id) {
  const std::int64_t max_slots = act.value("max_slots", 0);
  if (max_slots == 0) return true;
  const std::int64_t taken = count_taken(db, activity_id);
  return taken >= 0 && taken < max_slots;
}

// 名额不足时入候补：queue_no = 当前候补最大 + 1（须在事务内）
// 返回是否成功；失败时调用方应回滚，避免留下 status=5 但 queue_no=NULL 的记录
//（审查 Issue 3：NULL queue_no 会被 promote_waitlist 的 ORDER BY 提前递补插队）
bool enqueue_waitlist(Db& db, std::int64_t registration_id, std::int64_t activity_id,
                      std::int64_t now) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT IFNULL(MAX(queue_no), 0) AS m FROM registration "
               "WHERE activity_id = ? AND status = 5;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK || rows.empty()) {
    return false;
  }
  const std::int64_t queue_no = rows[0].value("m", 0) + 1;
  return db.execParams("UPDATE registration SET status = 5, queue_no = ?, updated_at = ? "
                       "WHERE registration_id = ?;",
                       nlohmann::json::array({queue_no, now, registration_id})) == SQLITE_OK;
}

// 提交 / 重新提交后的目标状态（need_review 决定），名额已由调用方判定
int target_status_after_submit(const nlohmann::json& act) {
  return act.value("need_review", 0) ? 1 : 2;
}

// 报名记录 + 活动关键列（供本人 / 管理侧通用）
bool reg_with_activity(Db& db, std::int64_t registration_id, nlohmann::json& out) {
  if (registration_id <= 0) return false;
  nlohmann::json rows;
  std::string qerr;
  if (db.query(
          "SELECT r.*, a.name AS activity_name, a.need_review, a.allow_modify, a.max_slots, "
          "a.status AS activity_status, a.start_time, a.end_time, a.is_deleted AS activity_deleted "
          "FROM registration r JOIN activity a ON r.activity_id = a.activity_id "
          "WHERE r.registration_id = ? LIMIT 1;",
          nlohmann::json::array({registration_id}), rows, qerr) != SQLITE_OK) {
    return false;
  }
  if (rows.empty()) return false;
  out = std::move(rows[0]);
  return true;
}

// 字段明细 join 定义（detail / admin_detail 复用）
void append_field_items(Db& db, std::int64_t registration_id, nlohmann::json& items) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query(
          "SELECT d.field_id, f.field_key, f.field_label, f.field_type, d.field_value "
          "FROM registration_data d JOIN form_field f ON d.field_id = f.field_id "
          "WHERE d.registration_id = ? ORDER BY f.sort_order, d.field_id;",
          nlohmann::json::array({registration_id}), rows, qerr) != SQLITE_OK) {
    return;
  }
  items = std::move(rows);
}

} // namespace

bool registration_row(Db& db, std::int64_t registration_id, nlohmann::json& out) {
  return reg_with_activity(db, registration_id, out);
}

// 同步递补候补队首（须在事务内）；返回是否完成递补（无候补 / 名额不足 / 失败为 false）
bool promote_waitlist(Db& db, std::int64_t activity_id, std::int64_t now) {
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT registration_id, uid FROM registration "
               "WHERE activity_id = ? AND status = 5 "
               "ORDER BY queue_no IS NULL, queue_no ASC LIMIT 1;",
               nlohmann::json::array({activity_id}), rows, qerr) != SQLITE_OK || rows.empty()) {
    return false;
  }
  nlohmann::json act;
  if (!activity_row(db, activity_id, true, act)) return false;
  // 递补前复核剩余名额：max_slots 可能已被调小（activity.update 允许），
  // 名额已满则不递补（保持候补），避免超员（审查 Issue 1）
  if (!slot_available(db, act, activity_id)) return false;
  const int new_status = target_status_after_submit(act);
  const std::int64_t rid = rows[0]["registration_id"].get<std::int64_t>();
  const std::int64_t uid = rows[0]["uid"].get<std::int64_t>();
  if (db.execParams("UPDATE registration SET status = ?, queue_no = NULL, updated_at = ? "
                    "WHERE registration_id = ?;",
                    nlohmann::json::array({new_status, now, rid})) != SQLITE_OK) {
    return false;
  }
  notify(db, uid, 3, "候补递补成功",
         "您报名的「" + act.value("name", "") + "」已获得名额，请留意后续安排。",
         activity_id);
  return true;
}

nlohmann::json registration_create(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json act;
  if (!activity_row(db, activity_id, false, act)) return cfg_err(kNotFound, "活动不存在或不可报名");
  const std::int64_t now = now_ts();
  if (!in_apply_window(act, now)) return cfg_err(kValidation, "当前不在报名窗口内");

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT registration_id, status FROM registration "
               "WHERE activity_id = ? AND uid = ? LIMIT 1;",
               nlohmann::json::array({activity_id, uid}), rows, qerr) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  if (!rows.empty()) {
    const std::int64_t rid = rows[0]["registration_id"].get<std::int64_t>();
    if (rows[0].value("status", 0) == 4) {
      // 复用已取消记录：重置为草稿并清空明细（registration.md 决策）
      if (db.execParams("UPDATE registration SET status = 0, current_step = 0, receipt_no = '', "
                        "queue_no = NULL, reviewer = NULL, review_time = NULL, review_remark = '', "
                        "checkin_time = NULL, updated_at = ? WHERE registration_id = ?;",
                        nlohmann::json::array({now, rid})) != SQLITE_OK ||
          db.execParams("DELETE FROM registration_data WHERE registration_id = ?;",
                        nlohmann::json::array({rid})) != SQLITE_OK) {
        db.rollback();
        return cfg_err(kDbError, "reset failed: " + db.lastError());
      }
      if (db.commit() != SQLITE_OK) {
        db.rollback();
        return cfg_err(kDbError, "commit failed: " + db.lastError());
      }
      return cfg_ok({{"registration_id", rid}, {"status", 0}});
    }
    db.rollback();
    return cfg_err(kConflict, "已报名，请勿重复报名");
  }
  if (db.execParams("INSERT INTO registration (activity_id, uid, status, current_step, "
                    "created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?);",
                    nlohmann::json::array({activity_id, uid, now, now})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "insert failed: " + db.lastError());
  }
  const std::int64_t rid = db.lastInsertRowid();
  if (db.commit() != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "commit failed: " + db.lastError());
  }
  return cfg_ok({{"registration_id", rid}, {"status", 0}});
}

nlohmann::json registration_save(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!reg_with_activity(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row["uid"].get<std::int64_t>() != uid) return cfg_err(kForbidden, "无权操作该报名");

  const int status = row.value("status", 0);
  if (status == 1) {  // 待审核修改需 allow_modify 且活动进行中
    if (!row.value("allow_modify", 0)) return cfg_err(kConflict, "该活动不允许修改报名");
    if (activity_status_of(row) != 1) return cfg_err(kConflict, "活动不在进行中，无法修改");
  } else if (status != 0) {
    return cfg_err(kConflict, "当前状态不可编辑");
  }

  const std::int64_t activity_id = row["activity_id"].get<std::int64_t>();
  const nlohmann::json& fields =
      args.contains("fields") && args["fields"].is_array() ? args["fields"] : nlohmann::json::array();
  const std::int64_t step = cfg_int(args, "current_step", 0);

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  // 提交字段须属于该活动（防跨活动注入）
  for (const auto& it : fields) {
    const std::int64_t fid = it.value("field_id", std::int64_t{0});
    if (fid <= 0) continue;
    nlohmann::json rows;
    std::string qerr;
    if (db.query("SELECT 1 FROM form_field f JOIN form fm ON f.form_id = fm.form_id "
                 "WHERE f.field_id = ? AND fm.activity_id = ? AND fm.is_deleted = 0 "
                 "AND f.is_deleted = 0 AND f.is_visible = 1 LIMIT 1;",
                 nlohmann::json::array({fid, activity_id}), rows, qerr) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "query failed: " + qerr);
    }
    if (rows.empty()) {
      db.rollback();
      return cfg_err(kValidation, "字段不属于该活动或已删除");
    }
    const nlohmann::json value = it.contains("value") ? it["value"] : nlohmann::json("");
    // field_value 为 TEXT 列：数组/对象（如多选）统一序列化为 JSON 字符串存储，
    // 与 submit 校验层契约一致（validation.cpp option_allowed 兼容字符串 JSON 数组）
    const nlohmann::json store_value =
        value.is_array() || value.is_object() ? nlohmann::json(value.dump()) : value;
    if (db.execParams("INSERT INTO registration_data (registration_id, field_id, field_value) "
                      "VALUES (?, ?, ?) ON CONFLICT(registration_id, field_id) DO UPDATE SET "
                      "field_value = excluded.field_value;",
                      nlohmann::json::array({registration_id, fid, store_value})) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "save failed: " + db.lastError());
    }
  }
  if (step > 0) {
    if (db.execParams("UPDATE registration SET current_step = ?, updated_at = ? "
                      "WHERE registration_id = ?;",
                      nlohmann::json::array({step, now_ts(), registration_id})) != SQLITE_OK) {
      db.rollback();
      return cfg_err(kDbError, "step update failed: " + db.lastError());
    }
  }
  if (db.commit() != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "commit failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json registration_submit(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!reg_with_activity(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row["uid"].get<std::int64_t>() != uid) return cfg_err(kForbidden, "无权操作该报名");

  const int status = row.value("status", 0);
  if (status == 0) {
    // 首次提交
  } else if (status == 3) {
    if (!row.value("allow_modify", 0)) return cfg_err(kConflict, "该活动不允许修改后重新提交");
  } else {
    return cfg_err(kConflict, "当前状态不可提交");
  }
  const std::int64_t now = now_ts();
  if (activity_status_of(row) != 1 || !in_apply_window(row, now)) {
    return cfg_err(kValidation, "当前不在报名窗口内");
  }

  const std::int64_t activity_id = row["activity_id"].get<std::int64_t>();
  // 取当前明细并校验（registration.md 四）
  nlohmann::json data_rows;
  std::string qerr;
  if (db.query("SELECT field_id, field_value AS value FROM registration_data "
               "WHERE registration_id = ?;",
               nlohmann::json::array({registration_id}), data_rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  const std::string verr = validate_submit_fields(db, activity_id, data_rows);
  if (!verr.empty()) return cfg_err(kValidation, verr);

  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  int new_status;
  std::int64_t queue_no = 0;
  if (slot_available(db, row, activity_id)) {
    new_status = target_status_after_submit(row);
  } else {
    new_status = 5;  // 满员入候补（防超卖兜底）
  }
  // receipt_no 仅首次提交生成（重新提交保留原凭证号）
  std::string receipt = row.value("receipt_no", "");
  if (receipt.empty()) receipt = "R" + std::to_string(activity_id) + "-" + std::to_string(registration_id);
  if (db.execParams("UPDATE registration SET status = ?, receipt_no = ?, queue_no = NULL, "
                    "reviewer = NULL, review_time = NULL, review_remark = '', updated_at = ? "
                    "WHERE registration_id = ?;",
                    nlohmann::json::array({new_status, receipt, now, registration_id})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  if (new_status == 5) {
    // 入队失败（写异常）→ 回滚，避免 status=5 但 queue_no=NULL 的插队记录（审查 Issue 3）
    if (!enqueue_waitlist(db, registration_id, activity_id, now)) {
      db.rollback();
      return cfg_err(kDbError, "候补入队失败: " + db.lastError());
    }
    nlohmann::json rows;
    if (db.query("SELECT queue_no FROM registration WHERE registration_id = ?;",
                 nlohmann::json::array({registration_id}), rows, qerr) == SQLITE_OK && !rows.empty()) {
      queue_no = rows[0].value("queue_no", 0);
    }
  }
  if (db.commit() != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "commit failed: " + db.lastError());
  }

  if (new_status == 5) {
    notify(db, uid, 3, "报名候补",
           "您报名的「" + row.value("activity_name", "") + "」名额已满，当前为候补第 " +
               std::to_string(queue_no) + " 位，有名额将自动递补。",
           activity_id);
  } else {
    notify(db, uid, 0, "报名成功",
           "您已成功报名「" + row.value("activity_name", "") + "」，凭证号 " + receipt + "。",
           activity_id);
  }
  return cfg_ok({{"status", new_status}, {"receipt_no", receipt},
                 {"queue_no", new_status == 5 ? nlohmann::json(queue_no)
                                              : nlohmann::json(nullptr)}});
}

nlohmann::json registration_cancel(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!reg_with_activity(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row["uid"].get<std::int64_t>() != uid) return cfg_err(kForbidden, "无权操作该报名");

  const int status = row.value("status", 0);
  if (status != 0 && status != 1 && status != 2 && status != 5) {
    return cfg_err(kConflict, "当前状态不可取消");
  }
  if (row.value("activity_deleted", 0) != 0) return cfg_err(kNotFound, "活动不存在");
  const std::int64_t now = now_ts();
  const std::int64_t end_time = row.value("end_time", 0);
  if (end_time != 0 && now >= end_time) return cfg_err(kConflict, "报名已截止，无法取消");

  const std::int64_t activity_id = row["activity_id"].get<std::int64_t>();
  if (db.begin() != SQLITE_OK) return cfg_err(kDbError, "begin failed");
  if (db.execParams("UPDATE registration SET status = 4, queue_no = NULL, updated_at = ? "
                    "WHERE registration_id = ?;",
                    nlohmann::json::array({now, registration_id})) != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "update failed: " + db.lastError());
  }
  // 占用名额的取消（1/2）释放名额并同步递补（registration.md 二）
  // 注：promote_waitlist 返回 false 可能是"无候补 / 名额不足"（正常路径），不视为失败
  if (status == 1 || status == 2) {
    promote_waitlist(db, activity_id, now);
  }
  if (db.commit() != SQLITE_OK) {
    db.rollback();
    return cfg_err(kDbError, "commit failed: " + db.lastError());
  }
  return cfg_ok({{"ok", true}});
}

nlohmann::json registration_detail(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!reg_with_activity(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (row["uid"].get<std::int64_t>() != uid) return cfg_err(kForbidden, "无权查看该报名");

  nlohmann::json items;
  append_field_items(db, registration_id, items);
  nlohmann::json reg = {
      {"registration_id", row["registration_id"]},
      {"activity_id", row["activity_id"]},
      {"activity_name", row.value("activity_name", "")},
      {"status", row.value("status", 0)},
      {"receipt_no", row.value("receipt_no", "")},
      {"current_step", row.value("current_step", 0)},
      {"queue_no", row["queue_no"].is_null() ? nlohmann::json(nullptr) : nlohmann::json(row.value("queue_no", 0))},
      {"review_remark", row.value("review_remark", "")},
      {"checkin_time", row["checkin_time"].is_null() ? nlohmann::json(nullptr) : nlohmann::json(row.value("checkin_time", 0))},
      {"created_at", row.value("created_at", 0)},
      {"updated_at", row.value("updated_at", 0)},
  };
  return cfg_ok({{"registration", std::move(reg)}, {"items", std::move(items)}});
}

nlohmann::json registration_mine(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  const std::int64_t page = std::max(cfg_int(args, "page", 1), std::int64_t{1});
  const std::int64_t page_size =
      std::max(std::int64_t{1}, std::min(cfg_int(args, "page_size", 20), std::int64_t{100}));

  std::string where = "WHERE r.uid = ?";
  nlohmann::json params = nlohmann::json::array({uid});
  if (args.contains("status")) {
    const std::int64_t st = cfg_int(args, "status", -1);
    if (st >= 0) {
      where += " AND r.status = ?";
      params.push_back(st);
    }
  }
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM registration r " + where + ";", params, rows, qerr) !=
      SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  const std::int64_t total = rows.empty() ? 0 : rows[0].value("c", 0);

  params.push_back(page_size);
  params.push_back((page - 1) * page_size);
  if (db.query("SELECT r.registration_id, r.activity_id, a.name AS activity_name, "
               "a.activity_type, a.start_time, a.end_time, a.status AS activity_status, "
               "r.status, r.receipt_no, r.queue_no, r.review_remark, r.checkin_time, r.created_at "
               "FROM registration r JOIN activity a ON r.activity_id = a.activity_id "
               "WHERE r.uid = ? ORDER BY r.registration_id DESC LIMIT ? OFFSET ?;",
               params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

nlohmann::json registration_admin_list(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t activity_id = cfg_int(args, "activity_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  if (!can_read_activity(db, uid, activity_id)) return cfg_err(kForbidden, "活动不在授权范围");
  const std::int64_t page = std::max(cfg_int(args, "page", 1), std::int64_t{1});
  const std::int64_t page_size =
      std::max(std::int64_t{1}, std::min(cfg_int(args, "page_size", 20), std::int64_t{100}));

  std::string where = "WHERE r.activity_id = ?";
  nlohmann::json params = nlohmann::json::array({activity_id});
  if (args.contains("status")) {
    const std::int64_t st = cfg_int(args, "status", -1);
    if (st >= 0) {
      where += " AND r.status = ?";
      params.push_back(st);
    }
  }
  const std::string kw = cfg_str(args, "keyword");
  if (!kw.empty()) {
    // 转义 LIKE 通配符（% _ \），防止关键词含通配符时扩大匹配（ESCAPE '\'，共享 escape_like）
    const std::string like = "%" + escape_like(kw) + "%";
    where += " AND (r.receipt_no LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' "
             "OR u.student_id LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')";
    params.push_back(like);
    params.push_back(like);
    params.push_back(like);
    params.push_back(like);
  }
  nlohmann::json rows;
  std::string qerr;
  if (db.query("SELECT COUNT(*) AS c FROM registration r JOIN \"user\" u ON r.uid = u.uid " +
                   where + ";",
               params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  const std::int64_t total = rows.empty() ? 0 : rows[0].value("c", 0);

  params.push_back(page_size);
  params.push_back((page - 1) * page_size);
  if (db.query("SELECT r.registration_id, r.uid, u.name AS user_name, u.student_id, u.phone, "
               "r.status, r.receipt_no, r.queue_no, r.review_remark, r.reviewer, r.review_time, "
               "r.checkin_time, r.current_step, r.created_at "
               "FROM registration r JOIN \"user\" u ON r.uid = u.uid " + where +
                   " ORDER BY r.registration_id LIMIT ? OFFSET ?;",
               params, rows, qerr) != SQLITE_OK) {
    return cfg_err(kDbError, "query failed: " + qerr);
  }
  return cfg_ok({{"items", std::move(rows)}, {"total", total}});
}

nlohmann::json registration_admin_detail(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = cfg_int(args, "uid", 0);
  const std::int64_t registration_id = cfg_int(args, "registration_id", 0);
  if (uid <= 0) return cfg_err(kForbidden, "未登录");
  nlohmann::json row;
  if (!reg_with_activity(db, registration_id, row)) return cfg_err(kNotFound, "报名记录不存在");
  if (!can_read_activity(db, uid, row["activity_id"].get<std::int64_t>())) {
    return cfg_err(kForbidden, "活动不在授权范围");
  }
  nlohmann::json items;
  append_field_items(db, registration_id, items);
  nlohmann::json user;
  nlohmann::json urows;
  std::string qerr;
  if (db.query("SELECT uid, name, student_id, college, phone, email FROM \"user\" "
               "WHERE uid = ? LIMIT 1;",
               nlohmann::json::array({row["uid"].get<std::int64_t>()}), urows, qerr) == SQLITE_OK &&
      !urows.empty()) {
    user = urows[0];
  }
  return cfg_ok({{"registration", row}, {"user", std::move(user)}, {"items", std::move(items)}});
}

} // namespace sacc
