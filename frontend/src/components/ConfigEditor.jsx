import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Spin, Switch, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminActivityApi, adminSystemConfigApi } from '../api/admin.js';
import { t, useI18n } from '../utils/i18n/index.js';

const { Text } = Typography;

// 枚举型配置：值 → 选项
const ENUM_KEYS = {
  checkin_mode: [0, 1, 2],
  notify_channel: [0, 1],
};

// 系统配置白名单（config.md 3.5）：未配置的键也需展示（区别于活动配置按需写入）
const SYS_KEYS = [
  { key: 'site_name', type: 2, group: 'site' },
  { key: 'max_upload_size', type: 1, group: 'upload' },
  { key: 'checkin_secret', type: 2, group: 'checkin', secret: true },
];

// 白名单展示名（缺失时回退 key 原文）
const keyLabel = (key, system) => t(system ? `admin.sys.config.${key}` : `admin.cfg.${key}`);

// 配置编辑器：
// - 活动模式（默认）：activityId 传入，走 activity_config.list/set
// - system 模式：activityId 为空，走 system_config.list/set；checkin_secret 掩码展示、留空不改
// config_type：0 布尔 / 1 数字 / 2 文本 / 3 JSON（后端 normalizeItem 校验）
export default function ConfigEditor({ activityId, readOnly, system }) {
  useI18n();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({});
  const [secretInput, setSecretInput] = useState('');
  const [hasSecret, setHasSecret] = useState(false);

  const queryKey = system ? ['system-config'] : ['activity-config', activityId];
  const fetchList = system
    ? adminSystemConfigApi.list
    : () => adminActivityApi.configList(activityId);
  const saveFn = system
    ? (payload) => adminSystemConfigApi.set({ items: payload })
    : (payload) => adminActivityApi.configSet(activityId, { items: payload });

  const { data, isLoading } = useQuery({ queryKey, queryFn: fetchList });
  const rawItems = useMemo(() => data?.items || [], [data]);

  // system 模式：合并白名单（未配置键也展示）；活动模式：直接使用返回项
  const items = useMemo(() => {
    if (!system) return rawItems;
    const byKey = new Map(rawItems.map((it) => [it.key, it]));
    return SYS_KEYS.map((def) => ({
      ...def,
      value: byKey.get(def.key)?.value ?? '',
      type: def.type,
    }));
  }, [system, rawItems]);

  useEffect(() => {
    if (!isLoading) {
      const init = {};
      items.forEach((it) => {
        if (it.secret) {
          setHasSecret(!!it.value);
          setSecretInput('');
          return;
        }
        if (ENUM_KEYS[it.key]) init[it.key] = Number(it.value);
        else if (it.type === 0) init[it.key] = it.value === '1' || it.value === true;
        else if (it.type === 1) init[it.key] = it.value === '' || it.value == null ? undefined : Number(it.value);
        else init[it.key] = it.value ?? '';
      });
      setValues(init);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let payload;
      if (system) {
        // 白名单全量保存：站点/上传直接提交（数字未设时跳过）；密钥仅修改时提交
        payload = [
          { key: 'site_name', value: values.site_name ?? '' },
        ];
        if (values.max_upload_size !== undefined && values.max_upload_size !== null) {
          payload.push({ key: 'max_upload_size', value: values.max_upload_size });
        }
        if (secretInput.trim()) payload.push({ key: 'checkin_secret', value: secretInput.trim() });
      } else {
        payload = items
          .map((it) => ({ key: it.key, value: values[it.key] ?? '' }))
          .filter((it) => values[it.key] !== undefined);
      }
      await saveFn(payload);
      queryClient.invalidateQueries({ queryKey });
      message.success(system ? t('admin.sys.config.save_ok') : t('admin.cfg.save_ok'));
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

  // 活动模式：无已配置项提示
  if (!system && items.length === 0) {
    return <Text type="secondary">{t('admin.cfg.empty_hint')}</Text>;
  }

  const renderControl = (it) => {
    // system 模式密钥：掩码展示，保存后不回显明文
    if (it.secret) {
      return (
        <Input.Password
          disabled={readOnly}
          value={secretInput}
          onChange={(e) => setSecretInput(e.target.value)}
          placeholder={hasSecret ? t('admin.sys.config.secret_placeholder_set') : t('admin.sys.config.secret_placeholder_unset')}
        />
      );
    }
    if (ENUM_KEYS[it.key]) {
      return (
        <Select
          disabled={readOnly}
          value={values[it.key]}
          onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))}
          options={ENUM_KEYS[it.key].map((v) => ({ value: v, label: t(`admin.cfg.${it.key}.${v}`) }))}
        />
      );
    }
    if (it.type === 0) {
      return (
        <Switch disabled={readOnly} checked={!!values[it.key]} onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))} />
      );
    }
    if (it.type === 1) {
      return (
        <InputNumber
          disabled={readOnly}
          style={{ width: '100%' }}
          value={values[it.key]}
          onChange={(v) => setValues((p) => ({ ...p, [it.key]: v }))}
        />
      );
    }
    if (it.type === 3) {
      return (
        <Input.TextArea
          disabled={readOnly}
          rows={3}
          value={values[it.key]}
          onChange={(e) => setValues((p) => ({ ...p, [it.key]: e.target.value }))}
        />
      );
    }
    return (
      <Input
        disabled={readOnly}
        value={values[it.key]}
        onChange={(e) => setValues((p) => ({ ...p, [it.key]: e.target.value }))}
      />
    );
  };

  // system 模式：按键前缀分组卡片；checkin_secret 缺失时警示
  if (system) {
    const groups = ['site', 'upload', 'checkin'];
    return (
      <div>
        {!hasSecret && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('admin.sys.config.secret_missing')}
          />
        )}
        <Row gutter={16}>
          {groups.map((g) => {
            const groupItems = items.filter((it) => it.group === g);
            return (
              <Col xs={24} lg={8} key={g}>
                <Card size="small" title={t(`admin.sys.config.group_${g}`)} style={{ marginBottom: 16 }}>
                  <Form layout="vertical">
                    {groupItems.map((it) => (
                      <Form.Item key={it.key} label={keyLabel(it.key, system)} extra={it.secret ? t('admin.sys.config.secret_hint') : undefined}>
                        {renderControl(it)}
                      </Form.Item>
                    ))}
                  </Form>
                </Card>
              </Col>
            );
          })}
        </Row>
        {!readOnly && (
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t('common.save')}
          </Button>
        )}
      </div>
    );
  }

  // 活动模式
  return (
    <Form layout="vertical">
      {items.map((it) => {
        const label = (
          <span>
            {keyLabel(it.key, false)} <span style={{ color: '#999', fontWeight: 400 }}>({it.key})</span>
          </span>
        );
        return (
          <Form.Item key={it.key} label={label} style={{ maxWidth: 480 }}>
            {renderControl(it)}
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
