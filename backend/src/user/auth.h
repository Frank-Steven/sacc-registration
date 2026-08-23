#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 认证业务（M1）：注册 / 登录（失败锁定）/ 资料查询 / 密码重置
// 返回统一响应 { code, data?, message? }，供 dispatch 分发（wasm 与 native 共用）。
nlohmann::json auth_register(Db& db, const nlohmann::json& args);
nlohmann::json auth_login(Db& db, const nlohmann::json& args);
nlohmann::json auth_me(Db& db, const nlohmann::json& args);
nlohmann::json auth_reset_request(Db& db, const nlohmann::json& args);
nlohmann::json auth_reset_confirm(Db& db, const nlohmann::json& args);

// PBKDF2 密码哈希（注册 / 重置 / 账号管理重置密码共用，底层见 crypto/kdf.h）
void hash_password(const std::string& password, std::string& out_salt, std::string& out_hash);

} // namespace sacc
