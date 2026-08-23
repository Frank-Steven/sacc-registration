import { Tag } from 'antd';
import { ActivityStatus } from '../constants/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

// 活动状态标签：status 0 草稿 / 1 进行中 / 2 已截止 / 3 已结束
export default function ActivityStatusTag({ status }) {
  useI18n();
  const meta = ActivityStatus[status] ?? { color: 'default' };
  const text = status in ActivityStatus ? t(`activityStatus.${status}`) : t('status.unknown', { status });
  return <Tag color={meta.color}>{text}</Tag>;
}
