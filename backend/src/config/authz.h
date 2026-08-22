#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>

#include "core/db.h"
#include "core/errors.h"

namespace sacc {

// ---------- 统一响应与参数提取（配置层共用；响应构造委托 core/errors.h，避免重复实现） ----------
inline nlohmann::json cfg_ok(nlohmann::json data) { return ok(std::move(data)); }
inline nlohmann::json cfg_err(int code, const std::string& msg) { return err(code, msg); }
std::string cfg_str(const nlohmann::json& args, const char* key);
std::int64_t cfg_int(const nlohmann::json& args, const char* key, std::int64_t def);
bool cfg_bool(const nlohmann::json& args, const char* key, bool def);
// 宽松 JSON 解析（wasm 为 -fno-exceptions 构建，禁用抛异常解析）：成功返回 true
bool json_parse_lenient(const std::string& s, nlohmann::json& out);

// ---------- 权限判定（config.md 一、权限模型） ----------
bool is_super_admin(Db& db, std::int64_t uid);    // role_id=1：全范围
bool has_any_admin_role(Db& db, std::int64_t uid); // role 1/2/3 任一（管理端可读）
bool is_manager(Db& db, std::int64_t uid);        // role 1/2（可写）

// 目标分组是否落在 uid 的 role_id 授权范围（含子树）；role 1 恒 true
bool group_in_scope(Db& db, std::int64_t uid, int role_id, std::int64_t group_id);
// 活动是否绑定在 uid 的 role_id 授权分组（含子树）内；role 1 恒 true
bool activity_in_scope(Db& db, std::int64_t uid, int role_id, std::int64_t activity_id);
// 写权限：role 1/2 且活动在 role 2 范围内
bool can_manage_activity(Db& db, std::int64_t uid, std::int64_t activity_id);
// 读权限：role 1/2/3 且活动在范围内
bool can_read_activity(Db& db, std::int64_t uid, std::int64_t activity_id);

// ---------- 对象存在性（include_deleted=false 时仅未软删） ----------
bool activity_row(Db& db, std::int64_t activity_id, bool include_deleted, nlohmann::json& out);
bool group_exists(Db& db, std::int64_t group_id, bool include_deleted);
bool form_row(Db& db, std::int64_t form_id, bool include_deleted, nlohmann::json& out);
bool field_row(Db& db, std::int64_t field_id, bool include_deleted, nlohmann::json& out);

// ---------- 审计（写操作自动记录，config.md 3.6） ----------
void audit_log(Db& db, std::int64_t operator_uid, const std::string& action,
               const std::string& target, const nlohmann::json& detail);

// ---------- 活动状态转移合法性（config.md 3.1） ----------
bool valid_status_transition(int from, int to, std::int64_t end_time, std::int64_t now);

} // namespace sacc
