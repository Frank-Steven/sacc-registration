import { Tag } from 'antd';
import { ROLE_COLORS } from '../theme/statusColors.js';
import { t, useI18n } from '../utils/i18n/index.js';

// 角色标签（M7 3.4 统一三色）：role_id 1 超管红 / 2 活动管理员蓝 / 3 审核员灰
export default function RoleTag({ roleId, roleName }) {
  useI18n();
  const color = ROLE_COLORS[roleId] ?? 'default';
  const text = roleName || t(`admin.sys.role.${roleId}`);
  return <Tag color={color}>{text}</Tag>;
}
