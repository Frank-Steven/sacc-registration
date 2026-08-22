#include "user/auth.h"

#include <cctype>
#include <cstring>
#include <string>

#include <sqlite3.h>

#include "core/util.h"
#include "crypto/kdf.h"

namespace sacc {

namespace {

constexpr int kOk = 0;
constexpr int kUnauthorized = 401;
constexpr int kForbidden = 403;
constexpr int kNotFound = 404;
constexpr int kConflict = 409;
constexpr int kValidation = 422;
constexpr int kDbError = 2001;

constexpr int kMaxLoginFail = 5;                  // 连续失败阈值
constexpr std::int64_t kLockSeconds = 900;        // 锁定 15 分钟
constexpr std::int64_t kResetExpireSeconds = 3600; // 重置令牌 1 小时
constexpr std::size_t kSaltLen = 16;              // 盐字节数

nlohmann::json ok(nlohmann::json data) {
  return nlohmann::json{{"code", kOk}, {"data", std::move(data)}};
}

nlohmann::json err(int code, const std::string& msg) {
  return nlohmann::json{{"code", code}, {"message", msg}};
}

std::string str(const nlohmann::json& args, const char* key) {
  const auto it = args.find(key);
  if (it == args.end() || !it->is_string()) return "";
  return it->get<std::string>();
}

// 用户名：3~32 位字母数字下划线
bool validUsername(const std::string& u) {
  if (u.size() < 3 || u.size() > 32) return false;
  for (const char c : u) {
    if (!(std::isalnum(static_cast<unsigned char>(c)) || c == '_')) return false;
  }
  return true;
}

// 密码：8~128 位
bool validPassword(const std::string& p) { return p.size() >= 8 && p.size() <= 128; }

// 邮箱：宽松校验（非空、含 @ 与点、长度受限）
bool validEmail(const std::string& e) {
  if (e.empty() || e.size() > 254) return false;
  const std::size_t at = e.find('@');
  if (at == std::string::npos || at == 0 || at + 1 >= e.size()) return false;
  const std::size_t dot = e.find('.', at);
  return dot != std::string::npos && dot + 1 < e.size();
}

int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}

std::string hexToBytes(const std::string& hex) {
  std::string bytes;
  for (std::size_t i = 0; i + 1 < hex.size(); i += 2) {
    bytes.push_back(static_cast<char>((hexVal(hex[i]) << 4) | hexVal(hex[i + 1])));
  }
  return bytes;
}

// 计算 PBKDF2 盐与哈希（hex）
void hashPassword(const std::string& password, std::string& out_salt, std::string& out_hash) {
  unsigned char salt[kSaltLen];
  random_bytes(salt, kSaltLen);
  unsigned char h[32];
  pbkdf2_sha256(reinterpret_cast<const unsigned char*>(password.data()), password.size(), salt,
                kSaltLen, kPbkdf2Iterations, h);
  out_salt = to_hex(salt, kSaltLen);
  out_hash = to_hex(h, sizeof(h));
}

// 校验密码与存储值是否一致
bool verifyPassword(const std::string& password, const std::string& salt_hex,
                    const std::string& hash_hex) {
  const std::string salt = hexToBytes(salt_hex);
  if (salt.size() != kSaltLen || hash_hex.size() != 64) return false;
  unsigned char h[32];
  pbkdf2_sha256(reinterpret_cast<const unsigned char*>(password.data()), password.size(),
                reinterpret_cast<const unsigned char*>(salt.data()), salt.size(),
                kPbkdf2Iterations, h);
  const std::string computed = to_hex(h, sizeof(h));
  return computed.size() == hash_hex.size() &&
         std::memcmp(computed.data(), hash_hex.data(), computed.size()) == 0;
}

// 用户公开资料（不含敏感字段）
nlohmann::json profileOf(const nlohmann::json& row) {
  return {
      {"uid", row.value("uid", 0)},
      {"username", row.value("username", "")},
      {"status", row.value("status", 0)},
      {"name", row.value("name", "")},
      {"student_id", row.value("student_id", "")},
      {"college", row.value("college", "")},
      {"phone", row.value("phone", "")},
      {"email", row.value("email", "")},
      {"created_at", row.value("created_at", 0)},
  };
}

// 按 uid 取账号+资料（不存在的行返回空）
bool loadProfile(Db& db, std::int64_t uid, nlohmann::json& out_row) {
  nlohmann::json rows;
  std::string qerr;
  const int rc = db.query(
      "SELECT a.uid, a.username, a.status, u.name, u.student_id, u.college, u.phone, u.email, "
      "u.created_at FROM account a JOIN \"user\" u ON u.uid = a.uid WHERE a.uid = ?;",
      nlohmann::json::array({uid}), rows, qerr);
  if (rc != SQLITE_OK || rows.empty()) return false;
  out_row = std::move(rows[0]);
  return true;
}

} // namespace

nlohmann::json auth_register(Db& db, const nlohmann::json& args) {
  const std::string username = str(args, "username");
  const std::string password = str(args, "password");
  if (!validUsername(username)) return err(kValidation, "用户名须为 3~32 位字母数字下划线");
  if (!validPassword(password)) return err(kValidation, "密码长度须为 8~128 位");

  std::string salt_hex, hash_hex;
  hashPassword(password, salt_hex, hash_hex);
  const std::int64_t now = now_ts();

  if (db.begin() != SQLITE_OK) return err(kDbError, "begin failed");
  // 用户名查重（返回友好冲突而非唯一约束报错）
  {
    nlohmann::json rows;
    std::string qerr;
    const int rc = db.query("SELECT uid FROM account WHERE username = ?;",
                            nlohmann::json::array({username}), rows, qerr);
    if (rc != SQLITE_OK) {
      db.rollback();
      return err(kDbError, "query failed: " + qerr);
    }
    if (!rows.empty()) {
      db.rollback();
      return err(kConflict, "用户名已存在");
    }
  }
  if (db.execParams("INSERT INTO account (uid, username, password_hash, salt, status, "
                    "login_fail_count, created_at) VALUES (NULL, ?, ?, ?, 0, 0, ?);",
                    nlohmann::json::array({username, hash_hex, salt_hex, now})) != SQLITE_OK) {
    db.rollback();
    return err(kDbError, "insert account failed: " + db.lastError());
  }
  const std::int64_t uid = db.lastInsertRowid();
  if (db.execParams(
          "INSERT INTO \"user\" (uid, name, student_id, college, phone, email, created_at) "
          "VALUES (?, ?, ?, ?, ?, ?, ?);",
          nlohmann::json::array({uid, str(args, "name"), str(args, "student_id"),
                                 str(args, "college"), str(args, "phone"), str(args, "email"),
                                 now})) != SQLITE_OK) {
    db.rollback();
    return err(kDbError, "insert user failed: " + db.lastError());
  }
  if (db.commit() != SQLITE_OK) return err(kDbError, "commit failed");

  nlohmann::json row;
  if (loadProfile(db, uid, row)) return ok(profileOf(row));
  return err(kDbError, "profile load failed");
}

nlohmann::json auth_login(Db& db, const nlohmann::json& args) {
  const std::string username = str(args, "username");
  const std::string password = str(args, "password");
  if (username.empty() || password.empty()) return err(kValidation, "用户名与密码不能为空");

  nlohmann::json rows;
  std::string qerr;
  const int rc = db.query(
      "SELECT uid, password_hash, salt, status, login_fail_count, lock_until FROM account "
      "WHERE username = ?;",
      nlohmann::json::array({username}), rows, qerr);
  if (rc != SQLITE_OK) return err(kDbError, "query failed: " + qerr);
  if (rows.empty()) return err(kUnauthorized, "用户名或密码错误");

  const nlohmann::json& row = rows[0];
  const std::int64_t uid = row.value("uid", 0);
  const int status = row.value("status", 0);
  const int fail_count = row.value("login_fail_count", 0);
  // lock_until 可空（NULL=未锁定），需先判空再取数（value() 对 null 会抛异常）
  const nlohmann::json& lu = row["lock_until"];
  const std::int64_t lock_until = lu.is_null() ? 0 : lu.get<std::int64_t>();
  const std::int64_t now = now_ts();

  if (status == 1) return err(kForbidden, "账号已禁用");
  if (lock_until > 0 && lock_until > now) {
    return err(kForbidden, "失败次数过多，账号已锁定，请稍后再试");
  }

  if (verifyPassword(password, row.value("salt", ""), row.value("password_hash", ""))) {
    if (db.execParams("UPDATE account SET login_fail_count = 0, lock_until = NULL, "
                      "last_login_at = ? WHERE uid = ?;",
                      nlohmann::json::array({now, uid})) != SQLITE_OK) {
      return err(kDbError, "update failed: " + db.lastError());
    }
    nlohmann::json profile;
    if (loadProfile(db, uid, profile)) return ok(profileOf(profile));
    return err(kDbError, "profile load failed");
  }

  // 失败计数 +1，达到阈值锁定
  const int next = fail_count + 1;
  if (next >= kMaxLoginFail) {
    if (db.execParams(
            "UPDATE account SET login_fail_count = ?, lock_until = ? WHERE uid = ?;",
            nlohmann::json::array({next, now + kLockSeconds, uid})) != SQLITE_OK) {
      return err(kDbError, "update failed: " + db.lastError());
    }
  } else if (db.execParams("UPDATE account SET login_fail_count = ? WHERE uid = ?;",
                           nlohmann::json::array({next, uid})) != SQLITE_OK) {
    return err(kDbError, "update failed: " + db.lastError());
  }
  return err(kUnauthorized, "用户名或密码错误");
}

nlohmann::json auth_me(Db& db, const nlohmann::json& args) {
  const std::int64_t uid = args.value("uid", 0);
  if (uid <= 0) return err(kValidation, "uid 无效");
  nlohmann::json profile;
  if (!loadProfile(db, uid, profile)) return err(kNotFound, "账号不存在");
  return ok(profileOf(profile));
}

nlohmann::json auth_reset_request(Db& db, const nlohmann::json& args) {
  const std::string email = str(args, "email");
  if (!validEmail(email)) return err(kValidation, "邮箱格式不正确");

  nlohmann::json rows;
  std::string qerr;
  const int rc = db.query("SELECT uid FROM \"user\" WHERE email = ? LIMIT 1;",
                          nlohmann::json::array({email}), rows, qerr);
  if (rc != SQLITE_OK) return err(kDbError, "query failed: " + qerr);
  // 不存在也返回成功，防账号枚举
  if (rows.empty()) return ok({{"ok", true}});

  const std::int64_t uid = rows[0].value("uid", 0);
  unsigned char t[32];
  random_bytes(t, sizeof(t));
  const std::string token = to_hex(t, sizeof(t));
  if (db.execParams("UPDATE account SET reset_token = ?, reset_expire = ? WHERE uid = ?;",
                    nlohmann::json::array({token, now_ts() + kResetExpireSeconds, uid})) !=
      SQLITE_OK) {
    return err(kDbError, "update failed: " + db.lastError());
  }
  // M1 无 SMTP：联调阶段直接返回令牌，接入邮件后移除
  return ok({{"ok", true}, {"token", token}});
}

nlohmann::json auth_reset_confirm(Db& db, const nlohmann::json& args) {
  const std::string token = str(args, "token");
  const std::string password = str(args, "new_password");
  if (token.size() < 16 || token.size() > 128) return err(kValidation, "重置令牌无效");
  if (!validPassword(password)) return err(kValidation, "密码长度须为 8~128 位");

  nlohmann::json rows;
  std::string qerr;
  const int rc = db.query(
      "SELECT uid FROM account WHERE reset_token = ? AND reset_expire > ?;",
      nlohmann::json::array({token, now_ts()}), rows, qerr);
  if (rc != SQLITE_OK) return err(kDbError, "query failed: " + qerr);
  if (rows.empty()) return err(kValidation, "重置令牌无效或已过期");

  const std::int64_t uid = rows[0].value("uid", 0);
  std::string salt_hex, hash_hex;
  hashPassword(password, salt_hex, hash_hex);
  if (db.execParams("UPDATE account SET password_hash = ?, salt = ?, reset_token = NULL, "
                    "reset_expire = NULL, login_fail_count = 0, lock_until = NULL WHERE uid = ?;",
                    nlohmann::json::array({hash_hex, salt_hex, uid})) != SQLITE_OK) {
    return err(kDbError, "update failed: " + db.lastError());
  }
  return ok({{"ok", true}});
}

} // namespace sacc
