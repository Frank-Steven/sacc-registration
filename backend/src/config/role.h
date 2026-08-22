#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 角色列表 / user_role 授权 / 审计日志（config.md 2.1 角色授权审计）
nlohmann::json role_list(Db& db, const nlohmann::json& args);
nlohmann::json user_role_grant(Db& db, const nlohmann::json& args);
nlohmann::json user_role_revoke(Db& db, const nlohmann::json& args);
nlohmann::json user_role_list(Db& db, const nlohmann::json& args);
nlohmann::json audit_log_list(Db& db, const nlohmann::json& args);

} // namespace sacc
