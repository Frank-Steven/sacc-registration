import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, List, Space, Spin, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { registrationApi } from '../../api/index.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import { formatTime, windowText } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Title, Text } = Typography;

const TABS = [
  { key: 'all', status: undefined },
  { key: '0', status: 0 },
  { key: '1', status: 1 },
  { key: '2', status: 2 },
  { key: '5', status: 5 },
  { key: '4', status: 4 },
];

// 工作台（需登录）：按状态分组的我的报名 + 快捷入口
export default function Workbench() {
  useI18n();
  const [statusKey, setStatusKey] = useState('all');
  const tab = TABS.find((tb) => tb.key === statusKey);

  const { data, isLoading } = useQuery({
    queryKey: ['my-registrations', statusKey],
    queryFn: () => registrationApi.mine({ status: tab.status, page: 1, page_size: 100 }),
  });

  const items = data?.items || [];

  const inWindow = (item) => {
    const now = dayjs();
    if (item.start_time > 0 && now.isBefore(dayjs.unix(item.start_time))) return false;
    if (item.end_time > 0 && !now.isBefore(dayjs.unix(item.end_time))) return false;
    return true;
  };

  const renderActions = (item) => {
    switch (item.status) {
      case 0:
        return (
          <Link to={`/activities/${item.activity_id}/register`}>
            <Button type="link" size="small">{t('common.continue_fill')}</Button>
          </Link>
        );
      case 3:
        return inWindow(item) ? (
          <Link to={`/activities/${item.activity_id}/register`}>
            <Button type="link" size="small">{t('workbench.resubmit')}</Button>
          </Link>
        ) : (
          <Tooltip title={t('workbench.resubmit_closed')}>
            <Button type="link" size="small" disabled>{t('workbench.resubmit')}</Button>
          </Tooltip>
        );
      case 5:
        return item.queue_no ? <Tag color="warning">{t('workbench.queue_no', { n: item.queue_no })}</Tag> : null;
      default:
        return null;
    }
  };

  return (
    <div>
      <Title level={4}>{t('nav.workbench')}</Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Link to="/activities">
            <Button type="primary">{t('nav.activities')}</Button>
          </Link>
          <Link to="/my-registrations">
            <Button>{t('nav.my_registrations')}</Button>
          </Link>
          <Link to="/profile">
            <Button>{t('nav.profile')}</Button>
          </Link>
        </Space>
      </Card>

      <Card>
        <Tabs
          activeKey={statusKey}
          onChange={setStatusKey}
          items={TABS.map((tb) => ({
            key: tb.key,
            label: tb.key === 'all' ? t('common.all') : t(`status.${tb.key}`),
          }))}
        />
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : items.length === 0 ? (
          <Empty description={t('workbench.empty')} />
        ) : (
          <List
            dataSource={items}
            renderItem={(item) => {
              const actions = renderActions(item);
              return (
                <List.Item actions={actions ? [actions] : undefined}>
                  <List.Item.Meta
                    title={
                      <Space wrap>
                        <Text strong>{item.activity_name}</Text>
                        <RegistrationStatusTag status={item.status} />
                      </Space>
                    }
                    description={
                      <Space direction="vertical" size={0}>
                        <Text type="secondary">{t('workbench.reg_time', { time: formatTime(item.created_at) })}</Text>
                        <Text type="secondary">{t('workbench.act_time', { time: windowText(item.start_time, item.end_time) })}</Text>
                        {item.status === 2 && item.receipt_no && (
                          <Text type="secondary">{t('workbench.receipt_no', { no: item.receipt_no })}</Text>
                        )}
                        {item.status === 3 && item.review_remark && (
                          <Text type="danger">{t('workbench.reject_reason', { reason: item.review_remark })}</Text>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}
