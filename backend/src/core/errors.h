#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>

namespace sacc {

// ---------- 统一错误码（后端深化审查 D1：全库共用，避免各文件重复定义导致漂移） ----------
constexpr int kOk = 0;
constexpr int kUnauthorized = 401;
constexpr int kForbidden = 403;
constexpr int kNotFound = 404;
constexpr int kConflict = 409;
constexpr int kValidation = 422;
constexpr int kDbError = 2001;

// ---------- 统一响应构造（D2：auth/dispatch/config 层共用，wasm -fno-exceptions 安全） ----------
inline nlohmann::json ok(nlohmann::json data) {
  return nlohmann::json{{"code", kOk}, {"data", std::move(data)}};
}

inline nlohmann::json err(int code, const std::string& msg) {
  return nlohmann::json{{"code", code}, {"message", msg}};
}

} // namespace sacc
