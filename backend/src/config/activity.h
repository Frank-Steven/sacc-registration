#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 活动 CRUD 与状态流转（config.md 2.1 活动 / 3.1 状态流转 / 3.2 删除限制）
nlohmann::json activity_create(Db& db, const nlohmann::json& args);
nlohmann::json activity_update(Db& db, const nlohmann::json& args);
nlohmann::json activity_detail(Db& db, const nlohmann::json& args);
nlohmann::json activity_list(Db& db, const nlohmann::json& args);
nlohmann::json activity_delete(Db& db, const nlohmann::json& args);
// 报名端公开详情（config.md 2.2 报名端）
nlohmann::json activity_public_detail(Db& db, const nlohmann::json& args);
nlohmann::json activity_public_list(Db& db, const nlohmann::json& args);

} // namespace sacc
