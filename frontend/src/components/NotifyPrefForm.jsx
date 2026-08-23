import { useMemo } from 'react';
import { Button, Checkbox, Flex, Grid, List, Popconfirm, Typography, App as AntApp } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';
import { NotifyType } from '../constants/index.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 通知偏好（M8 复选站内+邮箱）：按 NotifyType 0~4 五行，每行 Checkbox.Group 复选渠道，
// 改动即保存；「恢复默认」删除偏好记录。邮箱未填写时邮箱项禁用（含 Tooltip 说明）。
// 渠道 bitmask：1=站内信 / 2=邮箱 / 3=两者；全不选视为恢复默认（站内信）。
// M9 手机端：复选框与「恢复默认」按钮各自单独提行（不再右侧操作列）。
export default function NotifyPrefForm() {
  useI18n();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const hasEmail = !!useAuthStore((s) => s.user?.email);
  const screens = Grid.useBreakpoint();
  const isMobile = screens.lg === false;

  const { data, isLoading } = useQuery({
    queryKey: ['notify-prefs'],
    queryFn: () => userApi.notifyPrefList(),
  });

  // { notify_type: channel bitmask } 映射
  const prefs = useMemo(() => {
    const map = {};
    (data?.items ?? []).forEach((it) => {
      map[it.notify_type] = it.channel;
    });
    return map;
  }, [data]);

  // bitmask → 数组；未设置（默认站内信）→ [1]
  const toArray = (mask) => (mask === 2 ? [2] : mask === 3 ? [1, 2] : [1]);

  const handleChange = async (notifyType, channels) => {
    try {
      if (channels.length === 0) {
        // 全不选 → 恢复默认（站内信）
        await userApi.notifyPrefDelete(notifyType);
        message.success(t('notify.pref_reset'));
      } else {
        const mask = channels.reduce((a, b) => a | b, 0);
        await userApi.notifyPrefSet({ notify_type: notifyType, channel: mask });
        message.success(t('notify.pref_saved'));
      }
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

  // 「恢复默认」按钮（移动端单独一行；桌面端放操作列）
  const resetBtn = (notifyType, typeText) => (
    <Popconfirm
      key="reset"
      title={t('notify.pref_reset_confirm', { type: typeText })}
      onConfirm={() => handleReset(notifyType)}
    >
      <Button type="link" size="small" style={{ paddingLeft: 0 }}>
        {t('common.restore_default')}
      </Button>
    </Popconfirm>
  );

  return (
    <List
      dataSource={[0, 1, 2, 3, 4]}
      loading={isLoading}
      locale={{ emptyText: t('notify.pref_empty') }}
      renderItem={(notifyType) => {
        const known = NotifyType[notifyType];
        const typeText = known ? t(`notifyType.${notifyType}`) : t('notify.unknown', { n: notifyType });
        const mailDisabled = !hasEmail;
        const title = (
          <Text strong>
            {typeText}
            <Text type="secondary" style={{ fontWeight: 400 }}>
              {' '}
              ({notifyType})
            </Text>
          </Text>
        );
        const checkboxGroup = (
          <Checkbox.Group
            value={toArray(prefs[notifyType] ?? 1)}
            onChange={(channels) => handleChange(notifyType, channels)}
            options={[
              { value: 1, label: t('notify.channel_inapp') },
              {
                value: 2,
                label: t('notify.channel_email'),
                disabled: mailDisabled,
              },
            ]}
          />
        );
        const hint = mailDisabled && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('notify.channel_email_disabled')}
          </Text>
        );

        if (isMobile) {
          // M9 手机端：标题 / 复选框 / 恢复默认各自独占一行
          return (
            <List.Item>
              <Flex vertical gap={8} style={{ width: '100%' }}>
                {title}
                {checkboxGroup}
                {hint}
                <div>{resetBtn(notifyType, typeText)}</div>
              </Flex>
            </List.Item>
          );
        }
        return (
          <List.Item actions={[resetBtn(notifyType, typeText)]}>
            <List.Item.Meta title={title} description={t('notify.pref_desc')} />
            {checkboxGroup}
            {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
          </List.Item>
        );
      }}
    />
  );
}
