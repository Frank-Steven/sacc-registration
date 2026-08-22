import { Link } from 'react-router-dom';
import { Card, Progress, Space, Tag, Typography } from 'antd';
import { ActivityType } from '../constants/index.js';
import { windowText, quotaPercent } from '../utils/format.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 活动卡片：名称 / 形式 Tag / 报名窗口 / 名额进度 / 需审核标记，整卡可点击跳详情
export default function ActivityCard({ activity }) {
  useI18n();
  const type = ActivityType[activity.activity_type];
  const unlimited = !activity.max_slots || activity.max_slots <= 0;
  const pct = quotaPercent(activity.taken, activity.max_slots);
  const full = !unlimited && activity.taken >= activity.max_slots;

  return (
    <Link to={`/activities/${activity.activity_id}`} style={{ display: 'block' }}>
      <Card hoverable size="small" styles={{ body: { padding: 16 } }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space align="center" wrap>
            <Text strong style={{ fontSize: 15 }}>{activity.name}</Text>
            {type && <Tag color={type.color}>{t(`activityType.${activity.activity_type}`)}</Tag>}
            {activity.need_review && <Tag color="orange">{t('quota.need_review')}</Tag>}
          </Space>
          <Text type="secondary">{windowText(activity.start_time, activity.end_time)}</Text>
          {unlimited ? (
            <Text type="secondary">{t('quota.unlimited')}</Text>
          ) : (
            <div>
              <Progress
                percent={pct}
                size="small"
                status={full ? 'exception' : undefined}
                format={() => t('quota.left', { taken: activity.taken, max: activity.max_slots })}
              />
              {full && <Text type="danger" style={{ fontSize: 12 }}>{t('quota.full')}</Text>}
            </div>
          )}
        </Space>
      </Card>
    </Link>
  );
}
