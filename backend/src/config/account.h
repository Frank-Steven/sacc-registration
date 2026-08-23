#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 账号管理 / 数据统计（M7 系统管理 B1~B4，仅超管）：
// B1 user.admin_list：用户列表（关键字 / 状态筛选 + 角色聚合）
// B2 account.set_status：禁用 / 启用账号
// B3 account.admin_reset：重置密码（一次性返回随机密码）
// B4 db.stats：表行数 / 软删计数 / 库大小
nlohmann::json account_admin_list(Db& db, const nlohmann::json& args);
nlohmann::json account_set_status(Db& db, const nlohmann::json& args);
nlohmann::json account_admin_reset(Db& db, const nlohmann::json& args);
nlohmann::json db_stats(Db& db, const nlohmann::json& args);

} // namespace sacc
