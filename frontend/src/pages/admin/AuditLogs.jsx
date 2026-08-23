import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Empty, Form, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { adminAccountApi, adminAuditApi } from '../../api/admin.js';
import { auditDomain, AUDIT_DOMAINS } from '../../theme/statusColors.js';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// action 下拉（按操作域分组，与后端 audit_log 调用一致）
const ACTION_GROUPS = [
  {
    label: 'activity',
    options: ['create_activity', 'update_activity', 'delete_activity', 'bind_group', 'unbind_group',
      'set_activity_config', 'review_registration', 'checkin_registration', 'export_registration'],
  },
  {
    label: 'group',
    options: ['create_group', 'update_group', 'delete_group'],
  },
  {
    label: 'form',
    options: ['create_form', 'update_form', 'delete_form', 'create_form_field', 'update_form_field',
      'delete_form_field', 'create_form_template', 'update_form_template', 'delete_form_template', 'apply_form_template'],
  },
  {
    label: 'user_role',
    options: ['grant_role', 'revoke_role', 'account.set_status', 'account.admin_reset'],
  },
  {
    label: 'system',
    options: ['set_system_config'],
  },
];

// 解析 detail JSON 字符串 → 键值对（非 JSON 时原样返回）
function parseDetail(detail) {
  if (!detail) return null;
  try {
    const obj = typeof detail === 'string' ? JSON.parse(detail) : detail;
    if (obj && typeof obj === 'object') {
      return Object.entries(obj).map(([k, v]) => ({ k, v: JSON.stringify(v) }));
    }
    return null;
  } catch {
    return null;
  }
}

// 「前往」目标解析：target 前缀 → 路由
function targetLink(target, action) {
  if (!target) return null;
  const [prefix, id] = target.split(':');
  if (action === 'set_system_config') return '/admin/system-config';
  if (prefix === 'activity' && id) return `/admin/activities/${id}`;
  if (prefix === 'group' && id) return '/admin/groups';
  if (prefix === 'user' && id) return '/admin/accounts';
  return null;
}

// 审计检索（M7 十一，旅程 B/C）：筛选 / 分页 / diff 视图 / 前往跳转
export default function AuditLogs() {
  useI18n();
  useDocumentTitle();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    operator_uid: undefined,
    action: undefined,
    range: undefined, // [moment, moment]
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [opKw, setOpKw] = useState('');
  const [rawView, setRawView] = useState(false); // 纯文本 / 变更高亮

  // 从数据治理概览进入时预填时间范围（旅程 B）：?start=&end=（unix 秒）
  useEffect(() => {
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (start && end) {
      setFilters((f) => ({ ...f, range: [dayjs(Number(start) * 1000), dayjs(Number(end) * 1000)] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params = useMemo(() => {
    const p = { page, page_size: pageSize };
    if (filters.operator_uid) p.operator_uid = filters.operator_uid;
    if (filters.action) p.action = filters.action;
    if (filters.range?.[0]) p.start_time = filters.range[0].unix();
    if (filters.range?.[1]) p.end_time = filters.range[1].unix();
    return p;
  }, [filters, page, pageSize]);

  const { data, isFetching } = useQuery({
    queryKey: ['admin-audit', params],
    queryFn: () => adminAuditApi.list(params),
  });
  const items = data?.items || [];

  // 操作人搜索（用户名 → operator_uid，复用 B1）
  const { data: opData, isFetching: opFetching } = useQuery({
    queryKey: ['audit-operator-search', opKw],
    queryFn: () => adminAccountApi.adminList({ keyword: opKw, page_size: 10 }),
    enabled: !!opKw,
    staleTime: 30_000,
  });
  const operatorOptions = (opData?.items || []).map((u) => ({ value: u.uid, label: u.username }));

  const actionOptions = ACTION_GROUPS.map((g) => ({
    label: t(`admin.sys.audit.domain.${g.label}`),
    options: g.options.map((a) => ({ value: a, label: a })),
  }));

  const columns = [
    {
      title: t('admin.sys.audit.created'),
      dataIndex: 'created_at',
      width: 150,
      render: (v) => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(v)}</Text>,
    },
    {
      title: t('admin.sys.audit.actor'),
      dataIndex: 'operator_uid',
      width: 100,
      render: (v) => (v ? `#${v}` : '—'),
    },
    {
      title: t('admin.sys.audit.action_label'),
      dataIndex: 'action',
      width: 190,
      render: (v) => <Tag color={AUDIT_DOMAINS[auditDomain(v)]}>{v}</Tag>,
    },
    { title: t('admin.sys.audit.target'), dataIndex: 'target', width: 160, ellipsis: true, render: (v) => v || '—' },
    {
      title: t('admin.sys.audit.detail'),
      key: 'detail',
      ellipsis: true,
      render: (_, row) => {
        const entries = parseDetail(row.detail);
        if (!entries) return <Text type="secondary">{t('admin.sys.audit.no_detail')}</Text>;
        return (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {entries.map(({ k, v }) => `${k}=${v}`).join('  ')}
          </Text>
        );
      },
    },
    {
      title: '',
      key: 'op',
      width: 80,
      align: 'right',
      render: (_, row) => {
        const to = targetLink(row.target, row.action);
        return to ? (
          <Tooltip title={t('admin.sys.audit.go')}>
            <Button
              type="link"
              size="small"
              icon={<ArrowRightOutlined />}
              onClick={() => {
                navigate(to);
                message.success(t('admin.sys.audit.go_toast'));
              }}
            />
          </Tooltip>
        ) : null;
      },
    },
  ];

  // 展开行：变更字段高亮 / 纯文本切换
  const expandedRowRender = (row) => {
    const entries = parseDetail(row.detail);
    return (
      <div style={{ padding: '4px 8px' }}>
        <Space style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('admin.sys.audit.diff_hint')}</Text>
          <Button type="link" size="small" onClick={() => setRawView((v) => !v)}>
            {rawView ? t('admin.sys.audit.view_diff') : t('admin.sys.audit.view_json')}
          </Button>
        </Space>
        {rawView ? (
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{row.detail || t('admin.sys.audit.no_detail')}</pre>
        ) : entries && entries.length ? (
          <Space wrap size={[8, 8]}>
            {entries.map(({ k, v }) => (
              <Tag key={k} color="warning" style={{ fontFamily: 'monospace', marginInlineEnd: 0 }}>
                {k}: {v}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">{t('admin.sys.audit.no_detail')}</Text>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.audit.title')}</Title>
          <Text type="secondary">{t('admin.sys.audit.subtitle')}</Text>
        </div>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Form layout="inline" style={{ rowGap: 12 }}>
          <Form.Item label={t('admin.sys.audit.operator')} style={{ marginBottom: 0 }}>
            <Select
              showSearch
              allowClear
              style={{ width: 200 }}
              placeholder={t('admin.sys.audit.operator_all')}
              filterOption={false}
              loading={opFetching}
              value={filters.operator_uid}
              onSearch={(kw) => setOpKw(kw.trim())}
              onChange={(v) => { setFilters((f) => ({ ...f, operator_uid: v })); setPage(1); }}
              options={operatorOptions}
              notFoundContent={opKw ? undefined : null}
            />
          </Form.Item>
          <Form.Item label={t('admin.sys.audit.action')} style={{ marginBottom: 0 }}>
            <Select
              allowClear
              style={{ width: 260 }}
              placeholder={t('admin.sys.audit.action_all')}
              value={filters.action}
              onChange={(v) => { setFilters((f) => ({ ...f, action: v })); setPage(1); }}
              options={actionOptions}
            />
          </Form.Item>
          <Form.Item label={t('admin.sys.audit.time_range')} style={{ marginBottom: 0 }}>
            <DatePicker.RangePicker
              showTime
              placeholder={[t('admin.sys.audit.time_ph'), t('admin.sys.audit.time_ph')]}
              value={filters.range}
              onChange={(v) => { setFilters((f) => ({ ...f, range: v })); setPage(1); }}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card>
        <Table
          rowKey="log_id"
          size="middle"
          loading={isFetching}
          columns={columns}
          dataSource={items}
          expandable={{ expandedRowRender }}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.audit.empty')} /> }}
        />
      </Card>
    </div>
  );
}
