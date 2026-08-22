import { useState } from 'react';
import { List, Pagination, Tag, Typography, Flex, App as AntApp } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../api/index.js';
import { useNotificationStore } from '../stores/notification.js';
import { NotifyType } from '../constants/index.js';
import { formatTime } from '../utils/format.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 通知列表（可复用）：type 不传 = 全部，'unread' = 仅未读。
// 单条点击未读 → 标记已读并驱动顶栏角标递减；分页由本组件内部管理。
export default function NotificationCenter({ type }) {
  useI18n();
  const unreadOnly = type === 'unread' ? 1 : 0;
  const [page, setPage] = useState(1);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const decrement = useNotificationStore((s) => s.decrement);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', unreadOnly, page],
    queryFn: () => notificationApi.mine({ page, page_size: 10, unread_only: unreadOnly }),
  });

  const readMutation = useMutation({
    mutationFn: (nid) => notificationApi.read(nid),
    onSuccess: () => {
      decrement(1);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => message.error(err.message),
  });

  return (
    <>
      <List
        dataSource={data?.items ?? []}
        loading={isLoading}
        locale={{ emptyText: type === 'unread' ? t('notify.empty_unread') : t('notify.empty') }}
        renderItem={(item) => {
          const known = NotifyType[item.type];
          const color = known?.color ?? 'default';
          const typeText = known ? t(`notifyType.${item.type}`) : t('notify.unknown', { n: item.type });
          return (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => {
                if (!item.is_read) readMutation.mutate(item.notification_id);
              }}
            >
              <List.Item.Meta
                avatar={<Tag color={color}>{typeText}</Tag>}
                title={<Text strong={!item.is_read}>{item.title}</Text>}
                description={
                  <Flex vertical gap={4}>
                    <span>{item.content}</span>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatTime(item.created_at)}
                      {` · ${t(`notifyChannel.${item.channel}`)}`}
                    </Text>
                  </Flex>
                }
              />
            </List.Item>
          );
        }}
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
    </>
  );
}
