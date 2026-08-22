#include "core/dispatch.h"

#include <sqlite3.h>
#include <string>

#include "core/util.h"

namespace sacc {

namespace {
constexpr int kOk = 0;
constexpr int kUnknownOp = 1001;
constexpr int kInvalidRequest = 1002;
constexpr int kDbError = 2001;

nlohmann::json ok(nlohmann::json data) {
  return nlohmann::json{{"code", kOk}, {"data", std::move(data)}};
}

nlohmann::json err(int code, const std::string& msg) {
  return nlohmann::json{{"code", code}, {"message", msg}};
}

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
  return err(kUnknownOp, "unknown op: " + op);
}

} // namespace sacc
