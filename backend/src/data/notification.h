#pragma once

#include <nlohmann/json.hpp>

#include "core/db.h"

namespace sacc {

// 通知（registration.md 七）：写入 helper + 查询 ops
// notify()：按用户偏好 / 活动渠道决定站内信（channel=0，send_status=1 直写即达）
// 或邮件（channel=1，send_status=0，宿主 SMTP 发送后置 1/2）
void notify(Db& db, std::int64_t uid, int type, const std::string& title,
            const std::string& content, std::int64_t activity_id);

nlohmann::json notification_mine(Db& db, const nlohmann::json& args);
nlohmann::json notification_unread_count(Db& db, const nlohmann::json& args);
nlohmann::json notification_read(Db& db, const nlohmann::json& args);
nlohmann::json notification_read_all(Db& db, const nlohmann::json& args);

} // namespace sacc
