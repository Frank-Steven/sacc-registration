import { useEffect, useMemo, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Select, Space, Spin, Switch, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminActivityApi } from '../api/admin.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 枚举型配置：值 → 选项
const ENUM_KEYS = {
  checkin_mode: [0, 1, 2],
  notify_channel: [0, 1],
};

// 白名单展示名（缺失时回退 key 原文）
const keyLabel = (key) => t(`admin.cfg.${key}`);

// 活动配置编辑器：ConfigEditor（键值类型化，支持批量保存）
// config_type：0 布尔 / 1 数字 / 2 文本 / 3 JSON（后端 normalizeItem 校验）
export default function ConfigEditor({ activityId, readOnly }) {
  useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['activity-config', activityId],
    queryFn: () => adminActivityApi.configList(activityId),
  });
  // 后端返回 { items: [{key, value, type, remark}] }
  const items = useMemo(() => data?.items || [], [data]);

  useEffect(() => {
    if (!isLoading) {
      const init = {};
      items.forEach((it) => {
        if (ENUM_KEYS[it.key]) init[it.key] = Number(it.value);
        else if (it.type === 0) init[it.key] = it.value === '1' || it.value === true;
        else if (it.type === 1) init[it.key] = Number(it.value);
        else init[it.key] = it.value;
      });
      setValues(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = items
        .map((it) => ({ key: it.key, value: values[it.key] ?? '' }))
        .filter((it) => values[it.key] !== undefined);
      await adminActivityApi.configSet(activityId, { items: payload });
      queryClient.invalidateQueries({ queryKey: ['activity-config', activityId] });
      message.success(t('admin.cfg.save_ok'));
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin />
      </div>
    );
  }

  // 无已配置项（后端 activity_config 按需写入，新建活动默认无配置）
  if (items.length === 0) {
    return (
      <Text type="secondary">
        {t('admin.cfg.empty_hint')}
      </Text>
    );
  }

  return (
    <Form layout="vertical">
      {items.map((it) => {
        const label = (
          <span>
            {keyLabel(it.key)} <span style={{ color: '#999', fontWeight: 400 }}>({it.key})</span>
          </span>
        );
        let control = null;
        if (ENUM_KEYS[it.key]) {
          control = (
            <Select
              disabled={readOnly}
              value={values[it.key]}
              onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))}
              options={ENUM_KEYS[it.key].map((v) => ({
                value: v,
                label: t(`admin.cfg.${it.key}.${v}`),
              }))}
            />
          );
        } else if (it.type === 0) {
          control = (
            <Switch
              disabled={readOnly}
              checked={!!values[it.key]}
              onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))}
            />
          );
        } else if (it.type === 1) {
          control = (
            <InputNumber
              disabled={readOnly}
              style={{ width: '100%' }}
              value={values[it.key]}
              onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))}
            />
          );
        } else if (it.type === 3) {
          control = (
            <Input.TextArea
              disabled={readOnly}
              rows={3}
              value={values[it.key]}
              onChange={(e) => setValues((p) => ({ ...p, [it.key]: e.target.value }))}
            />
          );
        } else {
          control = (
            <Input
              disabled={readOnly}
              value={values[it.key]}
              onChange={(e) => setValues((p) => ({ ...p, [it.key]: e.target.value }))}
            />
          );
        }
        return (
          <Form.Item key={it.key} label={label} style={{ maxWidth: 480 }}>
            {control}
          </Form.Item>
        );
      })}
      {!readOnly && (
        <Form.Item>
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t('common.save')}
          </Button>
        </Form.Item>
      )}
    </Form>
  );
}
