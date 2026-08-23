import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Card, Dropdown, Input, Popconfirm, Select, Space, Table, Tabs } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminActivityApi } from '../../api/admin.js';
import ActivityStatusTag from '../../components/ActivityStatusTag.jsx';
import { ActivityType } from '../../constants/index.js';
import { formatTime, windowText } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';

// 状态转移表：当前状态 → 可用目标状态（非法转移后端 409 兜底）
const TRANSITIONS = {
  0: [{ to: 1, key: 'publish' }],
  1: [{ to: 0, key: 'withdraw' }, { to: 2, key: 'close' }],
  2: [{ to: 1, key: 'reopen' }, { to: 3, key: 'finish' }],
  3: [],
};

// 活动列表：状态 Tab / 类型 / 关键字 / 分页 + 状态流转 + 删除（仅草稿）
export default function Activities() {
  useI18n();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('all');
  const [trash, setTrash] = useState(false);
  const [type, setType] = useState(undefined);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const statusMap = { all: undefined, ...Object.fromEntries([0, 1, 2, 3].map((s) => [`s${s}`, s])) };

  const { data, isFetching } = useQuery({
    queryKey: ['admin-activities', tab, trash, type, keyword, page],
    queryFn: () =>
      adminActivityApi.list({
        status: statusMap[tab],
        activity_type: type,
        keyword: keyword || undefined,
        page,
        page_size: 10,
        include_deleted: trash || undefined,
      }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-activities'] });

  const doTransition = async (activity, to) => {
    try {
      await adminActivityApi.update(activity.activity_id, { status: to });
      message.success(t('admin.act.transition_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const doDelete = async (activity) => {
    try {
      await adminActivityApi.remove(activity.activity_id);
      message.success(t('admin.act.delete_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const columns = [
    {
      title: t('admin.act.name'),
      dataIndex: 'name',
      render: (name, r) => <a onClick={() => navigate(`/admin/activities/${r.activity_id}`)}>{name}</a>,
    },
    { title: t('admin.act.status'), dataIndex: 'status', width: 100, render: (s) => <ActivityStatusTag status={s} /> },
    {
      title: t('admin.act.type'),
      dataIndex: 'activity_type',
      width: 90,
      render: (v) => t(`activityType.${v}`),
    },
    { title: t('activity.window'), width: 230, render: (_, r) => windowText(r.start_time, r.end_time) },
    { title: t('admin.act.max_slots'), dataIndex: 'max_slots', width: 90, align: 'right' },
    { title: t('admin.act.created'), dataIndex: 'created_at', width: 150, render: (v) => formatTime(v) },
    {
      title: t('admin.act.actions'),
      width: 220,
      render: (_, r) => {
        if (trash || r.is_deleted) return <Space size={4}>—</Space>;
        const opts = TRANSITIONS[r.status] || [];
        return (
          <Space size={4}>
            <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/admin/activities/${r.activity_id}`)}>
              {t('admin.act.edit')}
            </Button>
            {opts.length > 0 && (
              <Dropdown
                menu={{
                  items: opts.map((o) => ({ key: o.to, label: t(`admin.act.${o.key}`) })),
                  onClick: ({ key }) => doTransition(r, Number(key)),
                }}
              >
                <Button size="small">{t('admin.act.transition') ?? t('admin.act.publish')}</Button>
              </Dropdown>
            )}
            {r.status === 0 && (
              <Popconfirm title={t('admin.act.confirm_delete')} okText={t('common.delete')} onConfirm={() => doDelete(r)}>
                <Button size="small" danger>{t('admin.act.delete')}</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/activities/new')}>
          {t('admin.act.new')}
        </Button>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => { setTab(k); setPage(1); }}
        items={[
          { key: 'all', label: t('common.all') },
          ...['s0', 's1', 's2', 's3'].map((k) => ({
            key: k,
            label: t(`activityStatus.${statusMap[k]}`),
          })),
        ]}
        tabBarExtraContent={
          <Space>
            <Select
              allowClear
              placeholder={t('admin.act.type_ph')}
              style={{ width: 130 }}
              value={type}
              onChange={(v) => { setType(v); setPage(1); }}
              options={[0, 1, 2].map((v) => ({ value: v, label: t(`activityType.${v}`) }))}
            />
            <Input.Search
              allowClear
              placeholder={t('admin.dashboard.keyword_ph')}
              style={{ width: 200 }}
              onSearch={(v) => { setKeyword(v.trim()); setPage(1); }}
            />
            <Button onClick={() => { setTrash((p) => !p); setTab('all'); setPage(1); }} type={trash ? 'primary' : 'default'}>
              {t('admin.act.recycle')}
            </Button>
          </Space>
        }
      />
      <Table
        rowKey="activity_id"
        size="small"
        loading={isFetching}
        dataSource={data?.items || []}
        columns={columns}
        pagination={{
          current: page,
          pageSize: 10,
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />
    </Card>
  );
}
