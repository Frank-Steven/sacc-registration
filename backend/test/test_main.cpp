#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>
#include <sqlite3.h>

#include "core/db.h"
#include "core/dispatch.h"
#include "core/util.h"
#include "crypto/kdf.h"

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

  // ============ 密码哈希（KDF 测试向量） ============
  {
    const auto sha = [](const std::string& s) {
      unsigned char h[32];
      sacc::sha256(reinterpret_cast<const unsigned char*>(s.data()), s.size(), h);
      return sacc::to_hex(h, 32);
    };
    CHECK(sha("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(sha("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(sha("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
          "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

    // PBKDF2-HMAC-SHA256（RFC 7914 测试向量，c=1 / c=2）
    unsigned char out[32];
    const unsigned char pw[] = "password";
    const unsigned char sl[] = "salt";
    sacc::pbkdf2_sha256(pw, 8, sl, 4, 1, out);
    CHECK(sacc::to_hex(out, 32) ==
          "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
    sacc::pbkdf2_sha256(pw, 8, sl, 4, 2, out);
    CHECK(sacc::to_hex(out, 32) ==
          "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
  }

  // ============ 认证（M1）：注册 / 登录 / 锁定 / 重置 ============
  {
    const std::string auth_path =
        std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") + "/sacc_auth_test.db";
    std::remove(auth_path.c_str());

    sacc::Db adb;
    CHECK(adb.open(auth_path) == SQLITE_OK);
    // 用真实迁移脚本建全部表（与宿主一致）
    {
      std::ifstream f(std::string(SACC_MIGRATIONS_DIR) + "/0001_init.sql");
      std::stringstream ss;
      ss << f.rdbuf();
      CHECK(adb.migrate(ss.str(), 1) == SQLITE_OK);
    }

    // 注册成功：返回资料且不含敏感字段
    r = invoke(adb, R"({"op":"auth.register","args":{"username":"alice","password":"secret1234","name":"Alice","email":"alice@example.com"}})");
    CHECK(r["code"] == 0);
    const std::int64_t alice_uid = r["data"]["uid"].get<std::int64_t>();
    CHECK(r["data"]["username"] == "alice");
    CHECK(r["data"]["name"] == "Alice");
    CHECK(r["data"]["email"] == "alice@example.com");
    CHECK(!r["data"].contains("password_hash"));

    // 重复用户名 → 409
    r = invoke(adb, R"({"op":"auth.register","args":{"username":"alice","password":"secret1234"}})");
    CHECK(r["code"] == 409);

    // 参数校验 → 422
    r = invoke(adb, R"({"op":"auth.register","args":{"username":"ab","password":"secret1234"}})");
    CHECK(r["code"] == 422);
    r = invoke(adb, R"({"op":"auth.register","args":{"username":"bob","password":"short"}})");
    CHECK(r["code"] == 422);

    // 登录成功
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"secret1234"}})");
    CHECK(r["code"] == 0);
    CHECK(r["data"]["uid"] == alice_uid);

    // 密码错误 → 401（不区分用户不存在）
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"wrongpass1"}})");
    CHECK(r["code"] == 401);
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"ghost","password":"wrongpass1"}})");
    CHECK(r["code"] == 401);

    // 连续失败至阈值锁定（已失败 1 次，再 4 次触发；第 5 次失败置锁但响应仍 401）
    for (int i = 0; i < 4; ++i) {
      r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"wrongpass1"}})");
      CHECK(r["code"] == 401);
    }
    // 锁定后正确密码也被拒
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"secret1234"}})");
    CHECK(r["code"] == 403);

    // me：存在 / 不存在
    r = invoke(adb, R"({"op":"auth.me","args":{"uid":)" + std::to_string(alice_uid) + R"(}})");
    CHECK(r["code"] == 0 && r["data"]["email"] == "alice@example.com");
    r = invoke(adb, R"({"op":"auth.me","args":{"uid":99999}})");
    CHECK(r["code"] == 404);

    // 重置：申请 → 令牌 → 确认 → 新密码登录（锁定随之解除）
    r = invoke(adb, R"({"op":"auth.reset_request","args":{"email":"alice@example.com"}})");
    CHECK(r["code"] == 0 && r["data"]["ok"] == true);
    const std::string reset_token = r["data"]["token"].get<std::string>();

    // 防枚举：不存在的邮箱也返回成功且无 token
    r = invoke(adb, R"({"op":"auth.reset_request","args":{"email":"nobody@example.com"}})");
    CHECK(r["code"] == 0 && r["data"]["ok"] == true && !r["data"].contains("token"));

    // 错误令牌 → 422
    r = invoke(adb, R"({"op":"auth.reset_confirm","args":{"token":"deadbeef","new_password":"newpass123"}})");
    CHECK(r["code"] == 422);

    // 有效令牌重置
    r = invoke(adb, R"({"op":"auth.reset_confirm","args":{"token":")" + reset_token + R"(","new_password":"newpass123"}})");
    CHECK(r["code"] == 0);

    // 新密码可登录；旧密码失效
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"newpass123"}})");
    CHECK(r["code"] == 0);
    r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"secret1234"}})");
    CHECK(r["code"] == 401);

    adb.close();
    std::remove(auth_path.c_str());
  }

  std::remove(db_path.c_str());

  if (failures == 0) {
    std::printf("all tests passed\n");
    return 0;
  }
  std::printf("%d check(s) failed\n", failures);
  return 1;
}
