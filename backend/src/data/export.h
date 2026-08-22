#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// ---------- 导出统计（M4，export.md） ----------
// 名单导出：registration.export（分块 JSON）/ registration.export_csv（一次性 CSV）
nlohmann::json registration_export(Db& db, const nlohmann::json& args);
nlohmann::json registration_export_csv(Db& db, const nlohmann::json& args);
// 单活动看板：状态分布 / 名额 / 字段分布
nlohmann::json registration_stats(Db& db, const nlohmann::json& args);
// 每日报名趋势（UTC 按天，补 0）
nlohmann::json registration_trend(Db& db, const nlohmann::json& args);
// 跨活动列表统计（分组范围过滤 + 计数）
nlohmann::json activity_stats(Db& db, const nlohmann::json& args);

} // namespace sacc
