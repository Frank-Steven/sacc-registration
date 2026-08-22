#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 报名字段校验（registration.md 四）：提交（registration.submit）时按活动表单字段执行
// 必填 / 类型 / 选项 / validation 规则校验；通过返回空串，失败返回首个错误消息。
std::string validate_submit_fields(Db& db, std::int64_t activity_id, const nlohmann::json& fields);

// 受限正则匹配（wasm 为 -fno-exceptions 构建，无法使用 std::regex）
// 支持：字面 / 转义（\\. \\* 等）/ . / \\d \\D \\w \\W \\s \\S / 字符类 [..] [^..]（含范围）/
// 量词 * + ? {n} {n,} {n,m} / 锚点 ^（仅开头）$（仅末尾）。整串匹配（隐式全匹配）。
bool match_pattern(const std::string& pattern, const std::string& text);

} // namespace sacc
