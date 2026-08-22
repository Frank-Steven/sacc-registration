#include "core/dispatch.h"

#include <sqlite3.h>
#include <string>

#include "config/activity.h"
#include "config/config.h"
#include "config/form.h"
#include "config/group.h"
#include "config/role.h"
#include "config/template.h"
#include "core/errors.h"
#include "core/util.h"
#include "data/checkin.h"
#include "data/export.h"
#include "data/notification.h"
#include "data/registration.h"
#include "data/review.h"
#include "data/subscribe.h"
#include "user/auth.h"

namespace sacc {

namespace {
constexpr int kUnknownOp = 1001;
constexpr int kInvalidRequest = 1002;

// 取 args 对象（缺省为空对象），非对象时按空处理
const nlohmann::json& argsOf(const nlohmann::json& req) {
  static const nlohmann::json kEmpty = nlohmann::json::object();
  if (req.contains("args") && req["args"].is_object()) return req["args"];
  return kEmpty;
}
} // namespace

nlohmann::json dispatch(Db& db, const nlohmann::json& req) {
  if (!req.is_object()) return err(kInvalidRequest, "request must be a JSON object");
  const std::string op = req.value("op", "");
  const auto& args = argsOf(req);

  if (op == "ping") {
    return ok({{"pong", true}, {"ts", now_ts()}, {"version", "0.1.0"}});
  }
  if (op == "echo") {
    return ok({{"message", args.value("message", "")}});
  }
  if (op == "sys.version") {
    return ok({{"name", "sacc-backend"}, {"version", "0.1.0"}, {"abi", 1}});
  }
  if (op == "db.init") {
    const std::string path = args.value("path", "./data/sacc.db");
    const int rc = db.open(path);
    if (rc != SQLITE_OK) return err(kDbError, "open db failed: " + db.lastError());
    return ok({{"user_version", db.userVersion()}});
  }
  if (op == "db.user_version") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    return ok({{"user_version", db.userVersion()}});
  }
  if (op == "db.migrate") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    const std::string sql = args.value("sql", "");
    const int version = args.value("version", 0);
    const int rc = db.migrate(sql, version);
    if (rc != SQLITE_OK) return err(kDbError, "migrate failed: " + db.lastError());
    return ok({{"user_version", db.userVersion()}});
  }
  if (op == "db.exec") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    const std::string sql = args.value("sql", "");
    const int rc = db.exec(sql);
    if (rc != SQLITE_OK) return err(kDbError, "exec failed: " + db.lastError());
    return ok({{"changes", db.lastChanges()}});
  }
  if (op == "db.exec_params") {
    // 参数化写通道（宿主直调，避免字符串拼接注入；params 为 JSON 数组，1 基绑定）
    if (!db.isOpen()) return err(kDbError, "db not open");
    const std::string sql = args.value("sql", "");
    const auto& params = args.contains("params") ? args["params"] : nlohmann::json();
    const int rc = db.execParams(sql, params);
    if (rc != SQLITE_OK) return err(kDbError, "exec failed: " + db.lastError());
    return ok({{"changes", db.lastChanges()}});
  }
  if (op == "db.query") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    const std::string sql = args.value("sql", "");
    const auto& params = args.contains("params") ? args["params"] : nlohmann::json();
    nlohmann::json rows;
    std::string qerr;
    const int rc = db.query(sql, params, rows, qerr);
    if (rc != SQLITE_OK) return err(kDbError, "query failed: " + qerr);
    return ok({{"rows", std::move(rows)}});
  }
  if (op == "db.tables") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    nlohmann::json rows;
    std::string qerr;
    const int rc = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
                            nullptr, rows, qerr);
    if (rc != SQLITE_OK) return err(kDbError, "query failed: " + qerr);
    nlohmann::json names = nlohmann::json::array();
    for (const auto& r : rows) names.push_back(r["name"]);
    return ok({{"tables", std::move(names)}});
  }
  // 备份（disaster-recovery.md 2.1）：在线复制主库到目标文件
  if (op == "db.backup") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    const std::string path = args.value("path", "");
    if (path.empty()) return err(kInvalidRequest, "path required");
    const int rc = db.backupTo(path);
    if (rc != SQLITE_OK) return err(kDbError, "backup failed: " + db.lastError());
    return ok({{"ok", true}});
  }
  // 认证业务（M1）：依赖已打开的数据库
  if (op == "auth.register" || op == "auth.login" || op == "auth.me" ||
      op == "auth.reset_request" || op == "auth.reset_confirm") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    if (op == "auth.register") return auth_register(db, args);
    if (op == "auth.login") return auth_login(db, args);
    if (op == "auth.me") return auth_me(db, args);
    if (op == "auth.reset_request") return auth_reset_request(db, args);
    if (op == "auth.reset_confirm") return auth_reset_confirm(db, args);
  }
  // 配置层业务（M2）：活动 / 分组 / 表单字段 / 模板 / 配置 / 角色授权 / 审计
  if (op.rfind("activity.", 0) == 0 || op.rfind("activity_group.", 0) == 0 ||
      op.rfind("activity_config.", 0) == 0 || op.rfind("group.", 0) == 0 ||
      op.rfind("form.", 0) == 0 || op.rfind("form_field.", 0) == 0 ||
      op.rfind("form_template.", 0) == 0 || op.rfind("system_config.", 0) == 0 ||
      op.rfind("user_role.", 0) == 0 || op == "role.list" || op == "audit_log.list") {
    if (!db.isOpen()) return err(kDbError, "db not open");
    if (op == "activity.create") return activity_create(db, args);
    if (op == "activity.update") return activity_update(db, args);
    if (op == "activity.detail") return activity_detail(db, args);
    if (op == "activity.list") return activity_list(db, args);
    if (op == "activity.delete") return activity_delete(db, args);
    if (op == "activity.public_list") return activity_public_list(db, args);
    if (op == "activity.public_detail") return activity_public_detail(db, args);
    if (op == "activity.stats") return activity_stats(db, args);  // M4 跨活动统计

    if (op == "group.create") return group_create(db, args);
    if (op == "group.update") return group_update(db, args);
    if (op == "group.delete") return group_delete(db, args);
    if (op == "group.tree") return group_tree(db, args);
    if (op == "activity_group.bind") return activity_group_bind(db, args);
    if (op == "activity_group.unbind") return activity_group_unbind(db, args);
    if (op == "activity_group.list") return activity_group_list(db, args);

    if (op == "form.create") return form_create(db, args);
    if (op == "form.update") return form_update(db, args);
    if (op == "form.delete") return form_delete(db, args);
    if (op == "form.detail") return form_detail(db, args);
    if (op == "form_field.create") return form_field_create(db, args);
    if (op == "form_field.update") return form_field_update(db, args);
    if (op == "form_field.delete") return form_field_delete(db, args);

    if (op == "form_template.create") return form_template_create(db, args);
    if (op == "form_template.update") return form_template_update(db, args);
    if (op == "form_template.delete") return form_template_delete(db, args);
    if (op == "form_template.list") return form_template_list(db, args);
    if (op == "form_template.save_from_activity") return form_template_save_from_activity(db, args);
    if (op == "form_template.apply") return form_template_apply(db, args);

    if (op == "activity_config.set") return activity_config_set(db, args);
    if (op == "activity_config.get") return activity_config_get(db, args);
    if (op == "activity_config.list") return activity_config_list(db, args);
    if (op == "system_config.set") return system_config_set(db, args);
    if (op == "system_config.get") return system_config_get(db, args);
    if (op == "system_config.list") return system_config_list(db, args);

    if (op == "role.list") return role_list(db, args);
    if (op == "user_role.grant") return user_role_grant(db, args);
    if (op == "user_role.revoke") return user_role_revoke(db, args);
    if (op == "user_role.list") return user_role_list(db, args);
    if (op == "audit_log.list") return audit_log_list(db, args);
  }
  // 报名链路业务（M3）：报名 / 审核 / 签到 / 通知 / 订阅
  if (op.rfind("registration.", 0) == 0 || op.rfind("checkin.", 0) == 0 ||
      op.rfind("notification.", 0) == 0 || op.rfind("subscribe.", 0) == 0) {
    if (!db.isOpen()) return err(kDbError, "db not open");
    if (op == "registration.create") return registration_create(db, args);
    if (op == "registration.save") return registration_save(db, args);
    if (op == "registration.submit") return registration_submit(db, args);
    if (op == "registration.cancel") return registration_cancel(db, args);
    if (op == "registration.detail") return registration_detail(db, args);
    if (op == "registration.mine") return registration_mine(db, args);
    if (op == "registration.admin_list") return registration_admin_list(db, args);
    if (op == "registration.admin_detail") return registration_admin_detail(db, args);
    if (op == "registration.review") return registration_review(db, args);
    if (op == "registration.export") return registration_export(db, args);  // M4
    if (op == "registration.export_csv") return registration_export_csv(db, args);  // M4
    if (op == "registration.stats") return registration_stats(db, args);  // M4
    if (op == "registration.trend") return registration_trend(db, args);  // M4

    if (op == "checkin.do") return checkin_do(db, args);
    if (op == "checkin.mine") return checkin_mine(db, args);
    if (op == "checkin.code") return checkin_code(db, args);
    if (op == "checkin.code_current") return checkin_code_current(db, args);

    if (op == "notification.mine") return notification_mine(db, args);
    if (op == "notification.unread_count") return notification_unread_count(db, args);
    if (op == "notification.read") return notification_read(db, args);
    if (op == "notification.read_all") return notification_read_all(db, args);

    if (op == "subscribe.add") return subscribe_add(db, args);
    if (op == "subscribe.remove") return subscribe_remove(db, args);
    if (op == "subscribe.mine") return subscribe_mine(db, args);
  }
  return err(kUnknownOp, "unknown op: " + op);
}

} // namespace sacc
