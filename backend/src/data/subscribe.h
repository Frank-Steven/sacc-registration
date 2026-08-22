#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 活动订阅（registration.md 7.3）：订阅后活动开始前收到提醒（宿主定时任务触发）
nlohmann::json subscribe_add(Db& db, const nlohmann::json& args);
nlohmann::json subscribe_remove(Db& db, const nlohmann::json& args);
nlohmann::json subscribe_mine(Db& db, const nlohmann::json& args);

} // namespace sacc
