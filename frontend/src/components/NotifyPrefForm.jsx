import { useMemo } from 'react';
import { Button, List, Popconfirm, Select, Typography, App as AntApp } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api/index.js';
import { NotifyType } from '../constants/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 通知偏好：按 NotifyType 0~3 四行，每行 Select 渠道（站内信0/邮件1），改动即保存；
// 「恢复默认」删除偏好记录。写操作成功后 invalidateQueries(['notify-prefs'])。
export default function NotifyPrefForm() {
  useI18n();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notify-prefs'],
    queryFn: () => userApi.notifyPrefList(),
  });

  // { notify_type: channel } 映射，未设置的项走默认（站内信）
  const prefs = useMemo(() => {
    const map = {};
    (data?.items ?? []).forEach((it) => {
      map[it.notify_type] = it.channel;
    });
    return map;
  }, [data]);

  const handleSet = async (notifyType, channel) => {
    try {
      await userApi.notifyPrefSet({ notify_type: notifyType, channel });
      message.success(t('notify.pref_saved'));
      queryClient.invalidateQueries({ queryKey: ['notify-prefs'] });
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleReset = async (notifyType) => {
    try {
      await userApi.notifyPrefDelete(notifyType);
      message.success(t('notify.pref_reset'));
      queryClient.invalidateQueries({ queryKey: ['notify-prefs'] });
    } catch (err) {
      message.error(err.message);
    }
  };

  return (
    <List
      dataSource={[0, 1, 2, 3]}
      loading={isLoading}
      locale={{ emptyText: t('notify.pref_empty') }}
      renderItem={(notifyType) => {
        const known = NotifyType[notifyType];
        const typeText = known ? t(`notifyType.${notifyType}`) : t('notify.unknown', { n: notifyType });
        return (
          <List.Item
            actions={[
              <Popconfirm
                key="reset"
                title={t('notify.pref_reset_confirm', { type: typeText })}
                onConfirm={() => handleReset(notifyType)}
              >
                <Button type="link" size="small">
                  {t('common.restore_default')}
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Text strong>
                  {typeText}
                  <Text type="secondary" style={{ fontWeight: 400 }}>
                    {' '}
                    ({notifyType})
                  </Text>
                </Text>
              }
              description={t('notify.pref_desc')}
            />
            <Select
              value={prefs[notifyType]}
              placeholder={t('notify.pref_ph')}
              style={{ width: 140 }}
              options={[0, 1].map((c) => ({ value: c, label: t(`notifyChannel.${c}`) }))}
              onChange={(channel) => handleSet(notifyType, channel)}
            />
          </List.Item>
        );
      }}
    />
  );
}
