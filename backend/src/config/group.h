#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 分组树管理（仅超管）与活动绑定（config.md 2.1 分组 / 3.2 删除限制）
nlohmann::json group_create(Db& db, const nlohmann::json& args);
nlohmann::json group_update(Db& db, const nlohmann::json& args);
nlohmann::json group_delete(Db& db, const nlohmann::json& args);
nlohmann::json group_tree(Db& db, const nlohmann::json& args);
nlohmann::json activity_group_bind(Db& db, const nlohmann::json& args);
nlohmann::json activity_group_unbind(Db& db, const nlohmann::json& args);
nlohmann::json activity_group_list(Db& db, const nlohmann::json& args);

} // namespace sacc
