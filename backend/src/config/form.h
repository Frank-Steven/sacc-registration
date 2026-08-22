#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 表单 / 字段 CRUD（config.md 2.1 表单字段 / 3.2 删除限制 / 3.3 字段规则）
nlohmann::json form_create(Db& db, const nlohmann::json& args);
nlohmann::json form_update(Db& db, const nlohmann::json& args);
nlohmann::json form_delete(Db& db, const nlohmann::json& args);
nlohmann::json form_detail(Db& db, const nlohmann::json& args);
nlohmann::json form_field_create(Db& db, const nlohmann::json& args);
nlohmann::json form_field_update(Db& db, const nlohmann::json& args);
nlohmann::json form_field_delete(Db& db, const nlohmann::json& args);

} // namespace sacc
