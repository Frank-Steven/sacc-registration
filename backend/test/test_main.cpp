#include <cstdio>
#include <cstdlib>
#include <string>

#include <nlohmann/json.hpp>

#include "core/db.h"
#include "core/dispatch.h"

using nlohmann::json;

namespace {

int failures = 0;

#define CHECK(cond)                                                              \
  do {                                                                           \
    if (!(cond)) {                                                               \
      std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);       \
      ++failures;                                                                \
    }                                                                            \
  } while (0)

json invoke(sacc::Db& db, const std::string& req) {
  return sacc::dispatch(db, json::parse(req));
}

} // namespace

int main() {
  sacc::Db db;

  // ping / echo / sys.version
  json r = invoke(db, R"({"op":"ping"})");
  CHECK(r["code"] == 0 && r["data"]["pong"] == true);

  r = invoke(db, R"({"op":"echo","args":{"message":"hi"}})");
  CHECK(r["code"] == 0 && r["data"]["message"] == "hi");

  r = invoke(db, R"({"op":"sys.version"})");
  CHECK(r["code"] == 0 && r["data"]["version"] == "0.1.0");

  // 错误路径：未知 op / 非法 JSON
  r = invoke(db, R"({"op":"nope"})");
  CHECK(r["code"] == 1001);

  r = sacc::dispatch(db, json::parse(R"("just a string")"));
  CHECK(r["code"] == 1002);

  // 数据库：临时文件初始化 + 迁移 + 读写
  const std::string db_path =
      std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") + "/sacc_test.db";
  std::remove(db_path.c_str());

  r = invoke(db, R"({"op":"db.init","args":{"path":")" + db_path + R"("}})");
  CHECK(r["code"] == 0 && r["data"]["user_version"] == 0);

  const std::string ddl = "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT);";
  r = invoke(db, R"({"op":"db.migrate","args":{"sql":")" + ddl + R"(","version":1}})");
  CHECK(r["code"] == 0 && r["data"]["user_version"] == 1);

  // 未打开数据库时报错
  sacc::Db closed;
  r = invoke(closed, R"({"op":"db.query","args":{"sql":"SELECT 1;"}})");
  CHECK(r["code"] == 2001);

  r = invoke(db, R"({"op":"db.exec","args":{"sql":"INSERT INTO t(name) VALUES('a');"}})");
  CHECK(r["code"] == 0 && r["data"]["changes"] == 1);

  r = invoke(db, R"({"op":"db.query","args":{"sql":"SELECT id,name FROM t ORDER BY id;"}})");
  CHECK(r["code"] == 0);
  CHECK(r["data"]["rows"].size() == 1);
  CHECK(r["data"]["rows"][0]["name"] == "a");

  r = invoke(
      db, R"({"op":"db.query","args":{"sql":"SELECT name FROM t WHERE id=?;","params":[1]}})");
  CHECK(r["code"] == 0 && r["data"]["rows"][0]["name"] == "a");

  // 迁移失败回滚：user_version 不变，表不残留
  r = invoke(db, R"({"op":"db.migrate","args":{"sql":"CREATE TABLE t2(x); CREATE TABLE t2(y);","version":2}})");
  CHECK(r["code"] == 2001);
  r = invoke(db, R"({"op":"db.user_version"})");
  CHECK(r["data"]["user_version"] == 1);

  std::remove(db_path.c_str());

  if (failures == 0) {
    std::printf("all tests passed\n");
    return 0;
  }
  std::printf("%d check(s) failed\n", failures);
  return 1;
}
