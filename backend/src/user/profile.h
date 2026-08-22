#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 用户资料（M5，本人维度，args.uid 由宿主 JWT 注入）：
// - user.update：基础资料（name/student_id/college/phone/email）
// - user_common_info：常用信息（(uid, field_key) 唯一，报名表单预填数据源）
// - user_notify_pref：通知偏好（(uid, notify_type) 唯一，未配置走活动默认渠道）
// - user_pref：界面偏好（(uid, pref_key) 唯一，theme/locale 服务端持久化）
nlohmann::json user_update(Db& db, const nlohmann::json& args);
nlohmann::json user_common_info_list(Db& db, const nlohmann::json& args);
nlohmann::json user_common_info_save(Db& db, const nlohmann::json& args);
nlohmann::json user_common_info_delete(Db& db, const nlohmann::json& args);
nlohmann::json user_notify_pref_list(Db& db, const nlohmann::json& args);
nlohmann::json user_notify_pref_set(Db& db, const nlohmann::json& args);
nlohmann::json user_notify_pref_delete(Db& db, const nlohmann::json& args);
nlohmann::json user_pref_list(Db& db, const nlohmann::json& args);
nlohmann::json user_pref_set(Db& db, const nlohmann::json& args);

} // namespace sacc
