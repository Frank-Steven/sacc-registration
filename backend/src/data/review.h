#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 审核（registration.md 五）：通过 / 驳回；驳回释放名额并同步递补候补队首
nlohmann::json registration_review(Db& db, const nlohmann::json& args);

} // namespace sacc
