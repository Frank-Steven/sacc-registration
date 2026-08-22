#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 报名链路（registration.md）：草稿 / 保存 / 提交 / 取消 / 查询 + 名额与候补（同步递补）
nlohmann::json registration_create(Db& db, const nlohmann::json& args);
nlohmann::json registration_save(Db& db, const nlohmann::json& args);
nlohmann::json registration_submit(Db& db, const nlohmann::json& args);
nlohmann::json registration_cancel(Db& db, const nlohmann::json& args);
nlohmann::json registration_detail(Db& db, const nlohmann::json& args);
nlohmann::json registration_mine(Db& db, const nlohmann::json& args);
nlohmann::json registration_admin_list(Db& db, const nlohmann::json& args);
nlohmann::json registration_admin_detail(Db& db, const nlohmann::json& args);

// 供 review.cpp（驳回释放名额）复用：事务内将候补队首递补为待审核 / 已通过并写通知
void promote_waitlist(Db& db, std::int64_t activity_id, std::int64_t now);

// 报名记录行（未关联活动软删校验）；out 含 registration 全列 + activity 关键列
bool registration_row(Db& db, std::int64_t registration_id, nlohmann::json& out);

} // namespace sacc
