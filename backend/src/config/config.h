#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 活动 / 系统配置：key 白名单 + 类型化读写（config.md 2.1 配置 / 3.5 配置）
nlohmann::json activity_config_set(Db& db, const nlohmann::json& args);
nlohmann::json activity_config_get(Db& db, const nlohmann::json& args);
nlohmann::json activity_config_list(Db& db, const nlohmann::json& args);
nlohmann::json system_config_set(Db& db, const nlohmann::json& args);
nlohmann::json system_config_get(Db& db, const nlohmann::json& args);
nlohmann::json system_config_list(Db& db, const nlohmann::json& args);

} // namespace sacc
