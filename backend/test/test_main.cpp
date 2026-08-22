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
#include "data/validation.h"

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

    // 锁定到期（手动置过期）：计数清零放行，1 次错误不重新锁定，正确密码可登录
    {
      CHECK(adb.execParams("UPDATE account SET lock_until = ? WHERE uid = ?;",
                           nlohmann::json::array({sacc::now_ts() - 1, alice_uid})) == SQLITE_OK);
      r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"wrongpass1"}})");
      CHECK(r["code"] == 401);
      r = invoke(adb, R"({"op":"auth.login","args":{"username":"alice","password":"secret1234"}})");
      CHECK(r["code"] == 0);
    }

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

  // ============ 配置层（M2）：活动 / 分组 / 表单字段 / 模板 / 配置 / 授权 / 审计 ============
  {
    const std::string cfg_path =
        std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") + "/sacc_cfg_test.db";
    std::remove(cfg_path.c_str());

    sacc::Db cdb;
    CHECK(cdb.open(cfg_path) == SQLITE_OK);
    {
      std::ifstream f(std::string(SACC_MIGRATIONS_DIR) + "/0001_init.sql");
      std::stringstream ss;
      ss << f.rdbuf();
      CHECK(cdb.migrate(ss.str(), 1) == SQLITE_OK);
      std::ifstream f2(std::string(SACC_MIGRATIONS_DIR) + "/0002_seed_roles.sql");
      std::stringstream ss2;
      ss2 << f2.rdbuf();
      CHECK(cdb.migrate(ss2.str(), 2) == SQLITE_OK);
    }

    // 注册五个用户：root(超管引导) / admin_a / admin_b / reviewer / outsider
    auto reg = [&](const char* u) -> std::int64_t {
      json rr = invoke(cdb, std::string(R"({"op":"auth.register","args":{"username":")") + u +
                                        R"(","password":"secret1234","name":")" + u + R"("}})");
      CHECK(rr["code"] == 0);
      return rr["data"]["uid"].get<std::int64_t>();
    };
    const std::int64_t root_uid = reg("root");
    const std::int64_t admin_a_uid = reg("admin_a");
    const std::int64_t admin_b_uid = reg("admin_b");
    const std::int64_t reviewer_uid = reg("reviewer");
    const std::int64_t outsider_uid = reg("outsider");
    // 引导超管（首个超管直接写 user_role，后续经 grant）
    CHECK(cdb.execParams("INSERT INTO user_role (uid, role_id, group_id) VALUES (?, 1, NULL);",
                         nlohmann::json::array({root_uid})) == SQLITE_OK);

    // 分组树：g1 -> g1a；g2
    auto mk_group = [&](const char* name, std::int64_t parent) -> std::int64_t {
      json rr = invoke(cdb, R"({"op":"group.create","args":{"uid":)" + std::to_string(root_uid) +
                            R"(,"name":")" + name + R"(","parent_id":)" + std::to_string(parent) +
                            R"(}})");
      CHECK(rr["code"] == 0);
      return rr["data"]["group_id"].get<std::int64_t>();
    };
    const std::int64_t g1 = mk_group("Group1", 0);
    const std::int64_t g1a = mk_group("Group1A", g1);
    const std::int64_t g2 = mk_group("Group2", 0);

    // 非超管不能建分组
    r = invoke(cdb, R"({"op":"group.create","args":{"uid":)" + std::to_string(admin_a_uid) +
                      R"(,"name":"x"}})");
    CHECK(r["code"] == 403);
    // 移动到自身子树 → 409
    r = invoke(cdb, R"({"op":"group.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"group_id":)" + std::to_string(g1) + R"(,"parent_id":)" +
                      std::to_string(g1a) + R"(}})");
    CHECK(r["code"] == 409);
    // 删除有子分组的组 → 409
    r = invoke(cdb, R"({"op":"group.delete","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"group_id":)" + std::to_string(g1) + R"(}})");
    CHECK(r["code"] == 409);

    // 授权：admin_a→role2(g1 含子树)；admin_b→role2(g2)；reviewer→role3(g1)
    auto grant = [&](std::int64_t target, int role_id, std::int64_t group_id) {
      json rr = invoke(cdb, R"({"op":"user_role.grant","args":{"uid":)" + std::to_string(root_uid) +
                              R"(,"target_uid":)" + std::to_string(target) + R"(,"role_id":)" +
                              std::to_string(role_id) + R"(,"group_id":)" + std::to_string(group_id) +
                              R"(}})");
      CHECK(rr["code"] == 0);
    };
    grant(admin_a_uid, 2, g1);
    grant(admin_b_uid, 2, g2);
    grant(reviewer_uid, 3, g1);
    // 非超管授权 → 403
    r = invoke(cdb, R"({"op":"user_role.grant","args":{"uid":)" + std::to_string(admin_a_uid) +
                      R"(,"target_uid":)" + std::to_string(outsider_uid) + R"(,"role_id":3}})");
    CHECK(r["code"] == 403);

    // 活动：root 建 act1（后续绑定 g1/g2）；admin_b 建 act2（绑定 g2）
    std::int64_t act1 = 0, act2 = 0, act_draft = 0;
    {
      json rr = invoke(cdb, R"({"op":"activity.create","args":{"uid":)" + std::to_string(root_uid) +
                             R"(,"name":"Seminar 2026","activity_type":0,"need_review":true}})");
      CHECK(rr["code"] == 0);
      act1 = rr["data"]["activity_id"].get<std::int64_t>();
      // 活动管理员必须绑定授权分组
      rr = invoke(cdb, R"({"op":"activity.create","args":{"uid":)" + std::to_string(admin_a_uid) +
                         R"(,"name":"NoGroup","group_ids":[]}})");
      CHECK(rr["code"] == 422);
    }
    CHECK(invoke(cdb, R"({"op":"activity_group.bind","args":{"uid":)" + std::to_string(root_uid) +
                         R"(,"activity_id":)" + std::to_string(act1) + R"(,"group_id":)" +
                         std::to_string(g1) + R"(}})")["code"] == 0);
    CHECK(invoke(cdb, R"({"op":"activity_group.bind","args":{"uid":)" + std::to_string(root_uid) +
                         R"(,"activity_id":)" + std::to_string(act1) + R"(,"group_id":)" +
                         std::to_string(g2) + R"(}})")["code"] == 0);

    // 权限：outsider 不可见；admin_a（g1 范围）可见 act1
    r = invoke(cdb, R"({"op":"activity.detail","args":{"uid":)" + std::to_string(outsider_uid) +
                      R"(,"activity_id":)" + std::to_string(act1) + R"(}})");
    CHECK(r["code"] == 403);
    r = invoke(cdb, R"({"op":"activity.detail","args":{"uid":)" + std::to_string(admin_a_uid) +
                      R"(,"activity_id":)" + std::to_string(act1) + R"(}})");
    CHECK(r["code"] == 0);

    // 状态流转：0→1 发布；1→3 非法 409；1→2 截止；2→3 结束
    auto upd = [&](std::int64_t uid, std::int64_t act, int status) -> json {
      return invoke(cdb, R"({"op":"activity.update","args":{"uid":)" + std::to_string(uid) +
                            R"(,"activity_id":)" + std::to_string(act) + R"(,"status":)" +
                            std::to_string(status) + R"(}})");
    };
    CHECK(upd(root_uid, act1, 1)["code"] == 0);
    CHECK(upd(root_uid, act1, 3)["code"] == 409);
    CHECK(upd(root_uid, act1, 2)["code"] == 0);
    CHECK(upd(root_uid, act1, 3)["code"] == 0);

    // 删除限制：已发布不可删（409）；草稿可删
    r = invoke(cdb, R"({"op":"activity.delete","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act1) + R"(}})");
    CHECK(r["code"] == 409);
    {
      json rr = invoke(cdb, R"({"op":"activity.create","args":{"uid":)" + std::to_string(root_uid) +
                             R"(,"name":"Draft"}})");
      act_draft = rr["data"]["activity_id"].get<std::int64_t>();
    }
    r = invoke(cdb, R"({"op":"activity.delete","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act_draft) + R"(}})");
    CHECK(r["code"] == 0);

    // 范围：admin_b 建 act2 绑 g2；admin_a（g1 范围）不可见 act2
    {
      json rr = invoke(cdb, R"({"op":"activity.create","args":{"uid":)" + std::to_string(admin_b_uid) +
                             R"(,"name":"B-only","group_ids":[)" + std::to_string(g2) + R"(]}})");
      CHECK(rr["code"] == 0);
      act2 = rr["data"]["activity_id"].get<std::int64_t>();
    }
    r = invoke(cdb, R"({"op":"activity.list","args":{"uid":)" + std::to_string(admin_a_uid) + R"(}})");
    CHECK(r["code"] == 0 && r["data"]["total"] >= 1);
    r = invoke(cdb, R"({"op":"activity.detail","args":{"uid":)" + std::to_string(admin_a_uid) +
                      R"(,"activity_id":)" + std::to_string(act2) + R"(}})");
    CHECK(r["code"] == 403);

    // ===== 表单 / 字段（act1 上建 form1） =====
    std::int64_t form1 = 0, field_name = 0, field_gender = 0;
    {
      json rr = invoke(cdb, R"({"op":"form.create","args":{"uid":)" + std::to_string(root_uid) +
                             R"(,"activity_id":)" + std::to_string(act1) + R"(,"name":"基本信息"}})");
      CHECK(rr["code"] == 0);
      form1 = rr["data"]["form_id"].get<std::int64_t>();
      rr = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(root_uid) +
                         R"(,"form_id":)" + std::to_string(form1) +
                         R"(,"field_key":"student_name","field_label":"姓名","field_type":0,"is_required":true}})");
      CHECK(rr["code"] == 0);
      field_name = rr["data"]["field_id"].get<std::int64_t>();
      rr = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(root_uid) +
                         R"(,"form_id":)" + std::to_string(form1) +
                         R"(,"field_key":"gender","field_label":"性别","field_type":2,"options":"[\"男\",\"女\"]"}})");
      CHECK(rr["code"] == 0);
      field_gender = rr["data"]["field_id"].get<std::int64_t>();
    }
    // 非法 key / 缺 options / 重复 key
    r = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"form_id":)" + std::to_string(form1) +
                      R"(,"field_key":"Bad Key","field_label":"x","field_type":0}})");
    CHECK(r["code"] == 422);
    r = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"form_id":)" + std::to_string(form1) +
                      R"(,"field_key":"major","field_label":"专业","field_type":2}})");
    CHECK(r["code"] == 422);
    r = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"form_id":)" + std::to_string(form1) +
                      R"(,"field_key":"gender","field_label":"x","field_type":2,"options":"[\"a\"]"}})");
    CHECK(r["code"] == 409);
    // 冻结项：改 key / 改 type → 409；可改 label
    r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"field_id":)" + std::to_string(field_name) + R"(,"field_key":"name2"}})");
    CHECK(r["code"] == 409);
    r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"field_id":)" + std::to_string(field_name) + R"(,"field_type":1}})");
    CHECK(r["code"] == 409);
    r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"field_id":)" + std::to_string(field_name) + R"(,"field_label":"学生姓名"}})");
    CHECK(r["code"] == 0);
    // 草稿期 options 可自由修改
    r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"field_id":)" + std::to_string(field_gender) +
                      R"(,"options":"[\"男\",\"女\",\"保密\"]"}})");
    CHECK(r["code"] == 0);
    // form 有字段不可删；删光字段后可删表单
    r = invoke(cdb, R"({"op":"form.delete","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"form_id":)" + std::to_string(form1) + R"(}})");
    CHECK(r["code"] == 409);
    CHECK(invoke(cdb, R"({"op":"form_field.delete","args":{"uid":)" + std::to_string(root_uid) +
                        R"(,"field_id":)" + std::to_string(field_gender) + R"(}})")["code"] == 0);
    CHECK(invoke(cdb, R"({"op":"form_field.delete","args":{"uid":)" + std::to_string(root_uid) +
                        R"(,"field_id":)" + std::to_string(field_name) + R"(}})")["code"] == 0);
    r = invoke(cdb, R"({"op":"form.delete","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"form_id":)" + std::to_string(form1) + R"(}})");
    CHECK(r["code"] == 0);

    // ===== 进行中 options 仅追加（act2 上建 form2 + grade 字段） =====
    {
      json rr = invoke(cdb, R"({"op":"form.create","args":{"uid":)" + std::to_string(admin_b_uid) +
                             R"(,"activity_id":)" + std::to_string(act2) + R"(,"name":"报名表"}})");
      const std::int64_t f2 = rr["data"]["form_id"].get<std::int64_t>();
      rr = invoke(cdb, R"({"op":"form_field.create","args":{"uid":)" + std::to_string(admin_b_uid) +
                         R"(,"form_id":)" + std::to_string(f2) +
                         R"(,"field_key":"grade","field_label":"年级","field_type":3,"options":"[\"一\",\"二\"]"}})");
      const std::int64_t fld = rr["data"]["field_id"].get<std::int64_t>();
      CHECK(upd(admin_b_uid, act2, 1)["code"] == 0);  // 发布
      r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(admin_b_uid) +
                        R"(,"field_id":)" + std::to_string(fld) + R"(,"options":"[\"一\"]"}})");
      CHECK(r["code"] == 409);
      r = invoke(cdb, R"({"op":"form_field.update","args":{"uid":)" + std::to_string(admin_b_uid) +
                        R"(,"field_id":)" + std::to_string(fld) +
                        R"(,"options":"[\"一\",\"二\",\"三\"]"}})");
      CHECK(r["code"] == 0);
    }

    // ===== 模板：从 act2 生成快照 → 套用到 act1 =====
    std::int64_t tpl = 0;
    {
      json rr = invoke(cdb, R"({"op":"form_template.save_from_activity","args":{"uid":)" +
                             std::to_string(root_uid) + R"(,"activity_id":)" +
                             std::to_string(act2) + R"(,"name":"标准模板"}})");
      CHECK(rr["code"] == 0);
      tpl = rr["data"]["template_id"].get<std::int64_t>();
    }
    r = invoke(cdb, R"({"op":"form_template.apply","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"template_id":)" + std::to_string(tpl) + R"(,"activity_id":)" +
                      std::to_string(act1) + R"(}})");
    CHECK(r["code"] == 0);
    // outsider 无角色套模板 → 403
    r = invoke(cdb, R"({"op":"form_template.apply","args":{"uid":)" + std::to_string(outsider_uid) +
                      R"(,"template_id":)" + std::to_string(tpl) + R"(,"activity_id":)" +
                      std::to_string(act2) + R"(}})");
    CHECK(r["code"] == 403);

    // ===== 配置：登记 key 合法；未登记/类型不符 → 422；system_config 仅超管 =====
    r = invoke(cdb, R"({"op":"activity_config.set","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act2) +
                      R"(,"items":[{"key":"venue_name","value":"体育馆"},{"key":"checkin_mode","value":1}]}})");
    CHECK(r["code"] == 0);
    r = invoke(cdb, R"({"op":"activity_config.set","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act2) + R"(,"key":"nope","value":"x"}})");
    CHECK(r["code"] == 422);
    r = invoke(cdb, R"({"op":"activity_config.set","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act2) + R"(,"key":"checkin_mode","value":9}})");
    CHECK(r["code"] == 422);
    r = invoke(cdb, R"({"op":"activity_config.get","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act2) + R"(,"key":"venue_name"}})");
    CHECK(r["code"] == 0 && r["data"]["value"] == "体育馆");
    CHECK(invoke(cdb, R"({"op":"system_config.set","args":{"uid":)" + std::to_string(root_uid) +
                        R"(,"key":"site_name","value":"SACC"}})")["code"] == 0);
    r = invoke(cdb, R"({"op":"system_config.set","args":{"uid":)" + std::to_string(admin_a_uid) +
                      R"(,"key":"site_name","value":"hack"}})");
    CHECK(r["code"] == 403);

    // ===== 授权 / 审计 =====
    r = invoke(cdb, R"({"op":"user_role.revoke","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"target_uid":)" + std::to_string(root_uid) + R"(,"role_id":1}})");
    CHECK(r["code"] == 409);  // 最后一个超管不可撤销
    r = invoke(cdb, R"({"op":"user_role.revoke","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"target_uid":)" + std::to_string(reviewer_uid) + R"(,"role_id":3}})");
    CHECK(r["code"] == 0);
    r = invoke(cdb, R"({"op":"audit_log.list","args":{"uid":)" + std::to_string(root_uid) + R"(}})");
    CHECK(r["code"] == 0 && r["data"]["total"] >= 1);
    r = invoke(cdb, R"({"op":"audit_log.list","args":{"uid":)" + std::to_string(admin_a_uid) + R"(}})");
    CHECK(r["code"] == 403);

    // ===== db.backup：在线备份可独立打开读到数据 =====
    {
      const std::string backup_path =
          std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") +
          "/sacc_cfg_backup.db";
      std::remove(backup_path.c_str());
      r = invoke(cdb, R"({"op":"db.backup","args":{"path":")" + backup_path + R"("}})");
      CHECK(r["code"] == 0);
      sacc::Db bdb;
      CHECK(bdb.open(backup_path) == SQLITE_OK);
      json brows;
      std::string berr;
      CHECK(bdb.query("SELECT name FROM activity WHERE is_deleted = 0;", nullptr, brows, berr) ==
            SQLITE_OK);
      CHECK(brows.size() >= 1);
      bdb.close();
      std::remove(backup_path.c_str());
    }

    // ===== 报名端公开视图：进行中可见，草稿/未发布不可见 =====
    r = invoke(cdb, R"({"op":"activity.public_list"})");
    CHECK(r["code"] == 0);
    r = invoke(cdb, R"({"op":"activity.public_detail","args":{"activity_id":)" +
                      std::to_string(act_draft) + R"(}})");
    CHECK(r["code"] == 404);

    cdb.close();
    std::remove(cfg_path.c_str());
  }

  // ============ 报名链路（M3）：状态机 / 防超卖 / 候补递补 / 审核 / 签到 / 通知 / 订阅 ============
  {
    const std::string reg_path =
        std::string(std::getenv("TMPDIR") ? std::getenv("TMPDIR") : "/tmp") + "/sacc_reg_test.db";
    std::remove(reg_path.c_str());

    sacc::Db rdb;
    CHECK(rdb.open(reg_path) == SQLITE_OK);
    {
      std::ifstream f(std::string(SACC_MIGRATIONS_DIR) + "/0001_init.sql");
      std::stringstream ss;
      ss << f.rdbuf();
      CHECK(rdb.migrate(ss.str(), 1) == SQLITE_OK);
      std::ifstream f2(std::string(SACC_MIGRATIONS_DIR) + "/0002_seed_roles.sql");
      std::stringstream ss2;
      ss2 << f2.rdbuf();
      CHECK(rdb.migrate(ss2.str(), 2) == SQLITE_OK);
      std::ifstream f3(std::string(SACC_MIGRATIONS_DIR) + "/0003_notification_activity_id.sql");
      std::stringstream ss3;
      ss3 << f3.rdbuf();
      CHECK(rdb.migrate(ss3.str(), 3) == SQLITE_OK);
    }

    // 受限正则匹配器（wasm 无 std::regex）
    CHECK(sacc::match_pattern("^1\\d{10}$", "13800138000"));
    CHECK(!sacc::match_pattern("^1\\d{10}$", "1380013800x"));
    CHECK(!sacc::match_pattern("^1\\d{10}$", "3800138000"));
    CHECK(sacc::match_pattern("^[a-z]+$", "abc"));
    CHECK(!sacc::match_pattern("^[a-z]+$", "abc123"));
    CHECK(sacc::match_pattern("^\\d{4}-\\d{2}-\\d{2}$", "2026-08-22"));
    CHECK(!sacc::match_pattern("^\\d{4}-\\d{2}-\\d{2}$", "2026-8-22"));
    CHECK(sacc::match_pattern("^\\w{2,16}$", "user_01"));
    CHECK(!sacc::match_pattern("^\\w{2,16}$", "u"));
    CHECK(sacc::match_pattern("^[^@]+@[^@]+\\.com$", "a@b.com"));

    // 用户：root 超管 / admin_a 活动管理员(g1) / 普通用户 u1-u4 / outsider
    auto reg = [&](const char* u) -> std::int64_t {
      json rr = invoke(rdb, std::string(R"({"op":"auth.register","args":{"username":")") + u +
                             R"(","password":"secret1234","name":")" + u + R"("}})");
      CHECK(rr["code"] == 0);
      return rr["data"]["uid"].get<std::int64_t>();
    };
    const std::int64_t root_uid = reg("root");
    const std::int64_t admin_uid = reg("admin_a");
    const std::int64_t u1 = reg("user01");
    const std::int64_t u2 = reg("user02");
    const std::int64_t u3 = reg("user03");
    const std::int64_t u4 = reg("user04");
    const std::int64_t outsider = reg("outsider");
    CHECK(rdb.execParams("INSERT INTO user_role (uid, role_id, group_id) VALUES (?, 1, NULL);",
                         nlohmann::json::array({root_uid})) == SQLITE_OK);
    json rr = invoke(rdb, R"({"op":"group.create","args":{"uid":)" + std::to_string(root_uid) +
                          R"(,"name":"G1"}})");
    const std::int64_t g1 = rr["data"]["group_id"].get<std::int64_t>();
    CHECK(invoke(rdb, R"({"op":"user_role.grant","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"target_uid":)" + std::to_string(admin_uid) + R"(,"role_id":2,"group_id":)" +
                      std::to_string(g1) + R"(}})")["code"] == 0);

    // 活动 act：need_review / allow_modify / max_slots=2，绑 g1，发布
    rr = invoke(rdb, R"({"op":"activity.create","args":{"uid":)" + std::to_string(root_uid) +
                    R"(,"name":"Workshop","need_review":true,"allow_modify":true,"max_slots":2}})");
    const std::int64_t act = rr["data"]["activity_id"].get<std::int64_t>();
    CHECK(invoke(rdb, R"({"op":"activity_group.bind","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(,"group_id":)" +
                      std::to_string(g1) + R"(}})")["code"] == 0);
    CHECK(invoke(rdb, R"({"op":"activity.update","args":{"uid":)" + std::to_string(root_uid) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(,"status":1}})")["code"] == 0);

    // 表单 + 字段：姓名(必填 min_length=2) / 性别(单选) / 邮箱(regex) / 年龄(数字 18-100) / 爱好(多选 min_items=1)
    rr = invoke(rdb, R"({"op":"form.create","args":{"uid":)" + std::to_string(root_uid) +
                    R"(,"activity_id":)" + std::to_string(act) + R"(,"name":"报名表"}})");
    const std::int64_t form = rr["data"]["form_id"].get<std::int64_t>();
    auto mk_field = [&](const char* key, const char* label, int type, const char* extra) {
      json f = invoke(rdb, std::string(R"({"op":"form_field.create","args":{"uid":)") +
                           std::to_string(root_uid) + R"(,"form_id":)" + std::to_string(form) +
                           R"(,"field_key":")" + key + R"(","field_label":")" + label +
                           R"(","field_type":)" + std::to_string(type) + extra + R"(}})");
      CHECK(f["code"] == 0);
      return f["data"]["field_id"].get<std::int64_t>();
    };
    const std::int64_t f_name = mk_field("name", "姓名", 0, R"(,"is_required":true,"validation":"{\"min_length\":2}")");
    const std::int64_t f_gender = mk_field("gender", "性别", 2, R"(,"options":"[\"男\",\"女\"]")");
    const std::int64_t f_email = mk_field("email", "邮箱", 0, R"(,"validation":"{\"regex\":\"^[^@]+@[^@]+\\\\.com$\"}")");
    const std::int64_t f_age = mk_field("age", "年龄", 1, R"(,"validation":"{\"min\":18,\"max\":100}")");
    const std::int64_t f_hobby = mk_field("hobby", "爱好", 3, R"(,"options":"[\"篮球\",\"足球\",\"羽毛球\"]","validation":"{\"min_items\":1}")");
    (void)f_name; (void)f_gender; (void)f_email; (void)f_age; (void)f_hobby;

    auto fields_json = [&](const std::string& payload) {
      return std::string(R"("fields":[)") + payload + R"(],"current_step":1)";
    };

    // ===== 报名（草稿 → 保存 → 提交） =====
    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u1) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 0);
    const std::int64_t r1 = rr["data"]["registration_id"].get<std::int64_t>();
    // 重复报名 → 409
    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u1) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 409);

    // 草稿保存：字段正确
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u1) +
                  R"(,"registration_id":)" + std::to_string(r1) + "," +
                  fields_json(R"({"field_id":)" + std::to_string(f_name) + R"(,"value":"Alice"},{"field_id":)" +
                              std::to_string(f_gender) + R"(,"value":"女"},{"field_id":)" +
                              std::to_string(f_email) + R"(,"value":"a@b.com"},{"field_id":)" +
                              std::to_string(f_age) + R"(,"value":20},{"field_id":)" +
                              std::to_string(f_hobby) + R"(,"value":"[\"篮球\"]"})") + R"(}})");
    CHECK(rr["code"] == 0);
    // 保存不属于该活动的字段 → 422
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u1) +
                  R"(,"registration_id":)" + std::to_string(r1) + "," +
                  fields_json(R"({"field_id":99999,"value":"x"})") + R"(}})");
    CHECK(rr["code"] == 422);

    // 提交（need_review=1 → 待审核），生成凭证号
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u1) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 1);
    const std::string receipt1 = rr["data"]["receipt_no"].get<std::string>();
    CHECK(receipt1 == "R" + std::to_string(act) + "-" + std::to_string(r1));
    // 已提交不可再提交
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u1) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 409);

    // u2：缺必填姓名 → 提交 422
    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u2) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    const std::int64_t r2 = rr["data"]["registration_id"].get<std::int64_t>();
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + R"(}})");
    CHECK(rr["code"] == 422);
    // u2：姓名长度不足 + 错误选项 + 年龄越界 + 非法邮箱 → 422
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + "," +
                  fields_json(R"({"field_id":)" + std::to_string(f_name) + R"(,"value":"x"},{"field_id":)" +
                              std::to_string(f_gender) + R"(,"value":"未知"},{"field_id":)" +
                              std::to_string(f_email) + R"(,"value":"abc"},{"field_id":)" +
                              std::to_string(f_age) + R"(,"value":17},{"field_id":)" +
                              std::to_string(f_hobby) + R"(,"value":"[\"排球\"]"})") + R"(}})");
    CHECK(rr["code"] == 0);  // 保存不校验
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + R"(}})");
    CHECK(rr["code"] == 422);
    // u2 修正后提交成功
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + "," +
                  fields_json(R"({"field_id":)" + std::to_string(f_name) + R"(,"value":"Bob"},{"field_id":)" +
                              std::to_string(f_gender) + R"(,"value":"男"},{"field_id":)" +
                              std::to_string(f_email) + R"(,"value":"b@c.com"},{"field_id":)" +
                              std::to_string(f_age) + R"(,"value":22},{"field_id":)" +
                              std::to_string(f_hobby) + R"(,"value":"[\"足球\",\"羽毛球\"]"})") + R"(}})");
    CHECK(rr["code"] == 0);
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 1);

    // ===== 满员 → 候补（防超卖） =====
    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u3) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    const std::int64_t r3 = rr["data"]["registration_id"].get<std::int64_t>();
    auto fill_ok_fields = [&](const char* name, const char* gender, const char* email, int age) {
      return std::string(R"("fields":[{"field_id":)") + std::to_string(f_name) + R"(,"value":")" + name +
             R"("},{"field_id":)" + std::to_string(f_gender) + R"(,"value":")" + gender +
             R"("},{"field_id":)" + std::to_string(f_email) + R"(,"value":")" + email +
             R"("},{"field_id":)" + std::to_string(f_age) + R"(,"value":)" + std::to_string(age) +
             R"(},{"field_id":)" + std::to_string(f_hobby) + R"(,"value":"[\"篮球\"]"}],"current_step":1)";
    };
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u3) +
                  R"(,"registration_id":)" + std::to_string(r3) + "," + fill_ok_fields("Cara", "女", "c@d.com", 21) + R"(}})");
    CHECK(rr["code"] == 0);
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u3) +
                  R"(,"registration_id":)" + std::to_string(r3) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 5 && rr["data"]["queue_no"] == 1);

    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u4) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    const std::int64_t r4 = rr["data"]["registration_id"].get<std::int64_t>();
    rr = invoke(rdb, R"({"op":"registration.save","args":{"uid":)" + std::to_string(u4) +
                  R"(,"registration_id":)" + std::to_string(r4) + "," + fill_ok_fields("Dara", "女", "d@e.com", 23) + R"(}})");
    CHECK(rr["code"] == 0);
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u4) +
                  R"(,"registration_id":)" + std::to_string(r4) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 5 && rr["data"]["queue_no"] == 2);

    // ===== 审核：u1 通过 =====
    rr = invoke(rdb, R"({"op":"registration.review","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(,"approve":true}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 2);
    // 非审核角色 → 403；非待审核 → 409
    rr = invoke(rdb, R"({"op":"registration.review","args":{"uid":)" + std::to_string(outsider) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(,"approve":true}})");
    CHECK(rr["code"] == 403);
    rr = invoke(rdb, R"({"op":"registration.review","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(,"approve":true}})");
    CHECK(rr["code"] == 409);

    // ===== 取消 u2（待审核占名额）→ 释放 → u3 递补为待审核 =====
    rr = invoke(rdb, R"({"op":"registration.cancel","args":{"uid":)" + std::to_string(u2) +
                  R"(,"registration_id":)" + std::to_string(r2) + R"(}})");
    CHECK(rr["code"] == 0);
    rr = invoke(rdb, R"({"op":"registration.detail","args":{"uid":)" + std::to_string(u3) +
                  R"(,"registration_id":)" + std::to_string(r3) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["registration"]["status"] == 1);
    CHECK(rr["data"]["registration"]["queue_no"].is_null());
    // 已取消记录复用：u2 重新报名 → 新草稿
    rr = invoke(rdb, R"({"op":"registration.create","args":{"uid":)" + std::to_string(u2) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["registration_id"] == r2 && rr["data"]["status"] == 0);

    // ===== 审核驳回 u3 → 释放 → u4 递补；驳回写 remark =====
    rr = invoke(rdb, R"({"op":"registration.review","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r3) + R"(,"approve":false,"review_remark":"材料不全"}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 3);
    rr = invoke(rdb, R"({"op":"registration.detail","args":{"uid":)" + std::to_string(u4) +
                  R"(,"registration_id":)" + std::to_string(r4) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["registration"]["status"] == 1);

    // u3 重新提交：满员（u1 通过 + u4 待审核占满 2 名额）→ 转候补
    rr = invoke(rdb, R"({"op":"registration.submit","args":{"uid":)" + std::to_string(u3) +
                  R"(,"registration_id":)" + std::to_string(r3) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 5);

    // ===== 管理名单 / 详情 / 关键词过滤 =====
    rr = invoke(rdb, R"({"op":"registration.admin_list","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["total"] >= 4);
    rr = invoke(rdb, R"({"op":"registration.admin_list","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(,"status":5}})");
    CHECK(rr["code"] == 0 && rr["data"]["total"] == 1);
    rr = invoke(rdb, R"({"op":"registration.admin_detail","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["items"].size() == 5);
    rr = invoke(rdb, R"({"op":"registration.admin_list","args":{"uid":)" + std::to_string(outsider) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 403);
    // 本人视角 detail / mine
    rr = invoke(rdb, R"({"op":"registration.detail","args":{"uid":)" + std::to_string(outsider) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 403);
    rr = invoke(rdb, R"({"op":"registration.mine","args":{"uid":)" + std::to_string(u1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["total"] == 1);

    // ===== 通知：报名 / 候补 / 递补 / 审核结果 =====
    rr = invoke(rdb, R"({"op":"notification.mine","args":{"uid":)" + std::to_string(u1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["total"] >= 2);  // 报名成功 + 审核通过
    rr = invoke(rdb, R"({"op":"notification.unread_count","args":{"uid":)" + std::to_string(u1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["count"] >= 2);
    const std::int64_t nid = rr["code"] == 0 && rr["data"]["count"] > 0
                                 ? invoke(rdb, R"({"op":"notification.mine","args":{"uid":)" +
                                                 std::to_string(u1) + R"(}})")["data"]["items"][0]
                                       ["notification_id"]
                                       .get<std::int64_t>()
                                 : 0;
    CHECK(invoke(rdb, R"({"op":"notification.read","args":{"uid":)" + std::to_string(u1) +
                      R"(,"notification_id":)" + std::to_string(nid) + R"(}})")["code"] == 0);
    rr = invoke(rdb, R"({"op":"notification.unread_count","args":{"uid":)" + std::to_string(u1) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["count"] >= 1);
    CHECK(invoke(rdb, R"({"op":"notification.read_all","args":{"uid":)" + std::to_string(u1) + R"(}})")["code"] == 0);
    CHECK(invoke(rdb, R"({"op":"notification.read","args":{"uid":)" + std::to_string(u1) +
                      R"(,"notification_id":99999}})")["code"] == 404);

    // ===== 签到 =====
    // 现场模式（默认 0）：线上自助 409
    rr = invoke(rdb, R"({"op":"checkin.mine","args":{"uid":)" + std::to_string(u1) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 409);
    // 管理员扫码（按凭证号）
    rr = invoke(rdb, R"({"op":"checkin.do","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"receipt_no":")" + receipt1 + R"("}})");
    CHECK(rr["code"] == 0 && rr["data"]["checkin_time"] > 0);
    // 重复签到 → 409
    rr = invoke(rdb, R"({"op":"checkin.do","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r1) + R"(}})");
    CHECK(rr["code"] == 409);

    // 动态码签到：设置密钥 + checkin_mode=2
    rr = invoke(rdb, R"({"op":"system_config.set","args":{"uid":)" + std::to_string(root_uid) +
                  R"(,"key":"checkin_secret","value":"unit-test-secret-0123456789"}})");
    CHECK(rr["code"] == 0);
    rr = invoke(rdb, R"({"op":"activity_config.set","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(,"key":"checkin_mode","value":2}})");
    CHECK(rr["code"] == 0);
    // 主办方获取当前码（管理员/审核员权限；outsider 403）
    rr = invoke(rdb, R"({"op":"checkin.code_current","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["code"].get_ref<const std::string&>().size() == 6 &&
          rr["data"]["expires_in"] > 0);
    const std::string dyn_code = rr["data"]["code"].get<std::string>();
    CHECK(invoke(rdb, R"({"op":"checkin.code_current","args":{"uid":)" + std::to_string(outsider) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(}})")["code"] == 403);
    // u4 审核通过（已通过未签到），供动态码签到
    rr = invoke(rdb, R"({"op":"registration.review","args":{"uid":)" + std::to_string(admin_uid) +
                  R"(,"registration_id":)" + std::to_string(r4) + R"(,"approve":true}})");
    CHECK(rr["code"] == 0 && rr["data"]["status"] == 2);
    // 错误码 → 422；正确码 → 签到成功；重复 → 409
    rr = invoke(rdb, R"({"op":"checkin.code","args":{"uid":)" + std::to_string(u4) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(,"code":"000000"}})");
    CHECK(rr["code"] == 422);
    rr = invoke(rdb, R"({"op":"checkin.code","args":{"uid":)" + std::to_string(u4) +
                  R"(,"activity_id":)" + std::to_string(act) + R"(,"code":")" + dyn_code + R"("}})");
    CHECK(rr["code"] == 0);

    // ===== 订阅 =====
    CHECK(invoke(rdb, R"({"op":"subscribe.add","args":{"uid":)" + std::to_string(u2) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(}})")["code"] == 0);
    CHECK(invoke(rdb, R"({"op":"subscribe.add","args":{"uid":)" + std::to_string(u2) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(}})")["code"] == 409);
    rr = invoke(rdb, R"({"op":"subscribe.mine","args":{"uid":)" + std::to_string(u2) + R"(}})");
    CHECK(rr["code"] == 0 && rr["data"]["items"].size() == 1);
    CHECK(invoke(rdb, R"({"op":"subscribe.remove","args":{"uid":)" + std::to_string(u2) +
                      R"(,"activity_id":)" + std::to_string(act) + R"(}})")["code"] == 0);

    rdb.close();
    std::remove(reg_path.c_str());
  }

  std::remove(db_path.c_str());

  if (failures == 0) {
    std::printf("all tests passed\n");
    return 0;
  }
  std::printf("%d check(s) failed\n", failures);
  return 1;
}
