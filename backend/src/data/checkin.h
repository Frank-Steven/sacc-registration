#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 签到（registration.md 六）：管理员扫码 / 用户线上自助 / 线上动态码（TOTP 无状态）
nlohmann::json checkin_do(Db& db, const nlohmann::json& args);
nlohmann::json checkin_mine(Db& db, const nlohmann::json& args);
nlohmann::json checkin_code(Db& db, const nlohmann::json& args);
nlohmann::json checkin_code_current(Db& db, const nlohmann::json& args);

} // namespace sacc
