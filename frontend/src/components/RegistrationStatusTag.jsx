import { Tag } from 'antd';
import { RegistrationStatus } from '../constants/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

// 报名状态标签：status 0~5 → 颜色 / 文案（interaction-design.md 二）
export default function RegistrationStatusTag({ status, size }) {
  useI18n();
  const meta = RegistrationStatus[status] ?? { color: 'default' };
  const text = status in RegistrationStatus ? t(`status.${status}`) : t('status.unknown', { status });
  return <Tag color={meta.color} style={size === 'small' ? { fontSize: 12 } : undefined}>{text}</Tag>;
}
