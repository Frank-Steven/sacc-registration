import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Popconfirm, Radio, Space, Spin, Switch, Tabs, Typography,
} from 'antd';
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { adminActivityApi, adminRoleApi } from '../../api/admin.js';
import { useAuthStore } from '../../stores/auth.js';
import ConfigEditor from '../../components/ConfigEditor.jsx';
import FormDesigner from '../../components/FormDesigner.jsx';
import GroupTreeSelect from '../../components/GroupTreeSelect.jsx';
import ActivityStatusTag from '../../components/ActivityStatusTag.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';

const { Text } = Typography;

// 状态转移表（同列表页）
const TRANSITIONS = {
  0: [{ to: 1, key: 'publish' }],
  1: [{ to: 0, key: 'withdraw' }, { to: 2, key: 'close' }],
  2: [{ to: 1, key: 'reopen' }, { to: 3, key: 'finish' }],
  3: [],
};

const toUnix = (d) => (d ? d.unix() : 0);

// 活动编辑：基本信息 / 分组绑定 / 活动配置 / 报名表单；新建与编辑复用
export default function ActivityEdit() {
  useI18n();
  const { id } = useParams();
  // 静态路由 /admin/activities/new 下无 :id 参数（id 为 undefined）；动态路由 /:id 时 id 为数字字符串
  const isNew = !id || id === 'new';
  const activityId = isNew ? null : Number(id);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('basic');
  const [saving, setSaving] = useState(false);

  const uid = useAuthStore((s) => s.user?.uid);
  const { data: rolesData } = useQuery({
    queryKey: ['my-roles', uid],
    queryFn: () => adminRoleApi.myRoles(uid),
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
  });
  // user_role.list 返回 { items: [...] }
  const roles = rolesData?.items;
  // 仅超管 / 活动管理员可写；审核员只读
  const readOnly = Array.isArray(roles) && roles.length > 0 && !roles.some((r) => r.role_id === 1 || r.role_id === 2);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin-activity', activityId],
    queryFn: () => adminActivityApi.detail(activityId),
    enabled: !isNew && !!activityId,
    // 编辑页关闭全局轮询：防止 15s 刷新覆盖正在编辑的表单值
    refetchInterval: false,
  });

  // 详情就绪后填充基本信息表单
  useEffect(() => {
    if (!detail) return;
    form.setFieldsValue({
      name: detail.name,
      description: detail.description || '',
      activity_type: detail.activity_type,
      window: detail.start_time ? [dayjs.unix(detail.start_time), dayjs.unix(detail.end_time || detail.start_time)] : undefined,
      max_slots: detail.max_slots,
      need_review: !!detail.need_review,
      allow_modify: !!detail.allow_modify,
    });
  }, [detail, form]);

  const invalidate = () => {
    if (!isNew) queryClient.invalidateQueries({ queryKey: ['admin-activity', activityId] });
    queryClient.invalidateQueries({ queryKey: ['admin-activities'] });
  };

  // 新建 / 保存基本信息
  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || '',
      activity_type: values.activity_type,
      start_time: toUnix(values.window?.[0]),
      end_time: toUnix(values.window?.[1]),
      max_slots: values.max_slots ?? 0,
      need_review: !!values.need_review,
      allow_modify: !!values.allow_modify,
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await adminActivityApi.create(payload);
        message.success(t('admin.act.create_ok'));
        navigate(`/admin/activities/${created.activity_id}`, { replace: true });
      } else {
        await adminActivityApi.update(activityId, payload);
        message.success(t('admin.act.basic_saved'));
        invalidate();
      }
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // 状态流转
  const doTransition = async (to) => {
    try {
      await adminActivityApi.update(activityId, { status: to });
      message.success(t('admin.act.transition_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  // 分组绑定：diff 已选与当前绑定，增量 bind/unbind
  const groupIds = useMemo(() => (detail?.groups || []).map((g) => g.group_id), [detail]);
  const saveGroups = async (next) => {
    const cur = new Set(groupIds);
    const nx = new Set(next || []);
    try {
      for (const gid of cur) if (!nx.has(gid)) await adminActivityApi.unbindGroup(activityId, gid);
      for (const gid of nx) if (!cur.has(gid)) await adminActivityApi.bindGroup(activityId, gid);
      message.success(t('admin.act.update_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  if (isNew) {
    return (
      <Card
        size="small"
        title={t('admin.act.new_title')}
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/activities')}>{t('admin.act.back_list')}</Button>}
      >
        <Form form={form} layout="vertical" style={{ maxWidth: 640 }} initialValues={{ activity_type: 0, max_slots: 0, need_review: false, allow_modify: false }}>
          <Form.Item name="name" label={t('admin.act.name')} rules={[{ required: true, message: t('admin.act.name_ph') }]}>
            <Input maxLength={100} placeholder={t('admin.act.name_ph')} />
          </Form.Item>
          <Form.Item name="description" label={t('admin.act.desc')}>
            <Input.TextArea rows={3} maxLength={1000} />
          </Form.Item>
          <Form.Item name="activity_type" label={t('admin.act.type')} rules={[{ required: true }]}>
            <Radio.Group options={[0, 1, 2].map((v) => ({ value: v, label: t(`activityType.${v}`) }))} />
          </Form.Item>
          <Form.Item name="window" label={t('admin.act.window')} tooltip={t('admin.act.window_ph')}>
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="max_slots" label={t('admin.act.max_slots')} tooltip={t('admin.act.max_slots_hint')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="need_review" label={t('admin.act.need_review')} tooltip={t('admin.act.need_review_hint')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="allow_modify" label={t('admin.act.allow_modify')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              {t('common.save')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    );
  }

  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>;
  }
  if (!detail) {
    return <Alert type="warning" message={t('admin.act.not_found')} action={<Button onClick={() => navigate('/admin/activities')}>{t('admin.act.back_list')}</Button>} />;
  }

  const transitions = TRANSITIONS[detail.status] || [];
  const tabItems = [
    {
      key: 'basic',
      label: t('admin.act.basic'),
      children: (
        <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
          <Form.Item name="name" label={t('admin.act.name')} rules={[{ required: true, message: t('admin.act.name_ph') }]}>
            <Input maxLength={100} disabled={readOnly} />
          </Form.Item>
          <Form.Item name="description" label={t('admin.act.desc')}>
            <Input.TextArea rows={3} maxLength={1000} disabled={readOnly} />
          </Form.Item>
          <Form.Item name="activity_type" label={t('admin.act.type')} rules={[{ required: true }]}>
            <Radio.Group disabled={readOnly} options={[0, 1, 2].map((v) => ({ value: v, label: t(`activityType.${v}`) }))} />
          </Form.Item>
          <Form.Item name="window" label={t('admin.act.window')} style={{ maxWidth: 640 }}>
            <DatePicker.RangePicker showTime style={{ width: '100%' }} disabled={readOnly} />
          </Form.Item>
          <Form.Item name="max_slots" label={t('admin.act.max_slots')} tooltip={t('admin.act.max_slots_hint')}>
            <InputNumber min={0} style={{ width: '100%' }} disabled={readOnly} />
          </Form.Item>
          <Form.Item name="need_review" label={t('admin.act.need_review')} tooltip={t('admin.act.need_review_hint')} valuePropName="checked">
            <Switch disabled={readOnly} />
          </Form.Item>
          <Form.Item name="allow_modify" label={t('admin.act.allow_modify')} valuePropName="checked">
            <Switch disabled={readOnly} />
          </Form.Item>
          {!readOnly && (
            <Form.Item>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
                {t('common.save')}
              </Button>
            </Form.Item>
          )}
        </Form>
      ),
    },
    {
      key: 'groups',
      label: t('admin.act.groups'),
      children: (
        <Space direction="vertical" style={{ width: '100%', maxWidth: 480 }}>
          <Text type="secondary">{t('admin.act.groups_hint')}</Text>
          <GroupTreeSelect
            value={groupIds}
            disabled={readOnly}
            onChange={(v) => !readOnly && saveGroups(v)}
          />
        </Space>
      ),
    },
    {
      key: 'config',
      label: t('admin.act.config'),
      children: <ConfigEditor activityId={activityId} readOnly={readOnly} />,
    },
    {
      key: 'forms',
      label: t('admin.act.forms'),
      children: <FormDesigner activityId={activityId} readOnly={readOnly} />,
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/activities')} />
          <Text strong>{detail.name}</Text>
          <ActivityStatusTag status={detail.status} />
        </Space>
      }
      extra={
        !readOnly && transitions.length > 0 ? (
          <Space>
            {transitions.map((tr) => (
              <Popconfirm
                key={tr.to}
                title={t('admin.act.transition_confirm')}
                okText={t('common.confirm')}
                onConfirm={() => doTransition(tr.to)}
              >
                <Button type={tr.to === 1 ? 'primary' : 'default'}>{t(`admin.act.${tr.key}`)}</Button>
              </Popconfirm>
            ))}
          </Space>
        ) : undefined
      }
    >
      {readOnly && <Alert type="info" showIcon message={t('admin.act.readonly')} style={{ marginBottom: 12 }} />}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  );
}
