import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Tabs, List, Pagination, Typography, Flex, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { registrationApi } from '../../api/index.js';
import RegistrationStatusTag from '../../components/RegistrationStatusTag.jsx';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 状态筛选：全部 / 填写中0 / 待审核1 / 已通过2 / 候补5 / 已取消4 / 未通过3
const STATUS_TABS = [
  { key: 'all', labelKey: 'common.all', status: undefined },
  { key: '0', labelKey: 'status.0', status: 0 },
  { key: '1', labelKey: 'status.1', status: 1 },
  { key: '2', labelKey: 'status.2', status: 2 },
  { key: '5', labelKey: 'status.5', status: 5 },
  { key: '4', labelKey: 'status.4', status: 4 },
  { key: '3', labelKey: 'status.3', status: 3 },
];

export default function MyRegistrations() {
  useI18n();
  const navigate = useNavigate();
  const [statusKey, setStatusKey] = useState('all');
  const [page, setPage] = useState(1);
  const current = STATUS_TABS.find((tab) => tab.key === statusKey);

  const { data, isLoading } = useQuery({
    queryKey: ['my-registrations', current.status, page],
    queryFn: () => registrationApi.mine({ status: current.status, page, page_size: 10 }),
  });

  return (
    <Card title={t('reg.my_registrations')}>
      <Tabs
        activeKey={statusKey}
        items={STATUS_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        onChange={(key) => {
          setStatusKey(key);
          setPage(1);
        }}
      />
      <List
        dataSource={data?.items ?? []}
        loading={isLoading}
        locale={{ emptyText: t('reg.empty') }}
        renderItem={(item) => (
          <List.Item
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/my-registrations/${item.registration_id}`)}
            actions={
              item.status === 0
                ? [
                    <Link
                      key="continue"
                      to={`/activities/${item.activity_id}/register`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('common.continue_fill')}
                    </Link>,
                  ]
                : undefined
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  <Text strong>{item.activity_name}</Text>
                  <RegistrationStatusTag status={item.status} />
                </Space>
              }
              description={
                <Space direction="vertical" size={0}>
                  <Text type="secondary">{t('reg.created_at', { time: formatTime(item.created_at) })}</Text>
                  {item.status === 5 && item.queue_no != null && (
                    <Text type="secondary">{t('reg.queue_no', { n: item.queue_no })}</Text>
                  )}
                  {item.status === 3 && item.review_remark && (
                    <Text type="secondary">{t('reg.rejected_reason', { reason: item.review_remark })}</Text>
                  )}
                </Space>
              }
            />
          </List.Item>
        )}
      />
      <Flex justify="flex-end" style={{ marginTop: 16 }}>
        <Pagination
          current={page}
          pageSize={10}
          total={data?.total ?? 0}
          onChange={setPage}
          showSizeChanger={false}
        />
      </Flex>
    </Card>
  );
}
