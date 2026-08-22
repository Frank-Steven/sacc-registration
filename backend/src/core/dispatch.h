#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 处理请求 JSON { op, args }，返回统一响应 { code, data?, message? }。
// 该函数在 wasm 与 native 测试中共用。
nlohmann::json dispatch(Db& db, const nlohmann::json& req);

} // namespace sacc
