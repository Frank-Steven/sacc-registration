import { Button, Card, Tabs, Typography, Flex, App as AntApp } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { notificationApi } from '../../api/index.js';
import { useNotificationStore } from '../../stores/notification.js';
import NotificationCenter from '../../components/NotificationCenter.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Title } = Typography;

// 通知中心：Tabs（全部 / 未读）包裹可复用列表组件；顶栏角标轮询在 UserLayout，
// 本页仅驱动「全部已读」与单条已读的角标更新。
export default function Notifications() {
  useI18n();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const clear = useNotificationStore((s) => s.clear);

  const handleReadAll = async () => {
    try {
      await notificationApi.readAll();
      clear();
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      message.success(t('notify.read_all_success'));
    } catch (err) {
      message.error(err.message);
    }
  };

  return (
    <Card>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          {t('notify.title')}
        </Title>
        <Button onClick={handleReadAll}>{t('notify.read_all')}</Button>
      </Flex>
      <Tabs
        items={[
          { key: 'all', label: t('notify.all'), children: <NotificationCenter /> },
          { key: 'unread', label: t('notify.unread'), children: <NotificationCenter type="unread" /> },
        ]}
      />
    </Card>
  );
}
