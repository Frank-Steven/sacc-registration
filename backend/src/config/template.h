#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 表单模板：快照生成 / 套用（config.md 2.1 模板 / 3.4 模板套用）
nlohmann::json form_template_create(Db& db, const nlohmann::json& args);
nlohmann::json form_template_update(Db& db, const nlohmann::json& args);
nlohmann::json form_template_delete(Db& db, const nlohmann::json& args);
nlohmann::json form_template_list(Db& db, const nlohmann::json& args);
nlohmann::json form_template_save_from_activity(Db& db, const nlohmann::json& args);
nlohmann::json form_template_apply(Db& db, const nlohmann::json& args);

} // namespace sacc
