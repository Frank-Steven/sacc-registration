import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Button, Card, Drawer, Empty, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { SearchOutlined, SafetyCertificateOutlined, ReloadOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAccountApi, adminRoleApi } from '../../api/admin.js';
import RoleTag from '../../components/RoleTag.jsx';
import { useAuthStore } from '../../stores/auth.js';
import { ACCOUNT_COLORS } from '../../theme/statusColors.js';
import { formatTime } from '../../utils/format.js';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// 账号管理（M7 八）：搜索（防抖 300ms）/ 状态筛选 / 禁用启用（乐观更新）/ 重置密码（一次性展示 10s）
export default function AccountManager() {
  useI18n();
  useDocumentTitle();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [filters, setFilters] = useState({ keyword: '', status: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [drawerUid, setDrawerUid] = useState(null);
  const [resetPwd, setResetPwd] = useState(null); // { user, password }
  const timerRef = useRef(null);

  // 输入防抖 300ms 触发检索
  const [kw, setKw] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => ({ ...f, keyword: kw.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [kw]);

  const params = useMemo(() => {
    const p = { page, page_size: pageSize };
    if (filters.keyword) p.keyword = filters.keyword;
    if (filters.status !== '' && filters.status !== undefined) p.status = filters.status;
    return p;
  }, [filters, page, pageSize]);

  const { data, isFetching } = useQuery({
    queryKey: ['admin-accounts', params],
    queryFn: () => adminAccountApi.adminList(params),
  });
  const items = data?.items || [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-accounts'] });

  // 查看角色抽屉数据
  const { data: rolesData } = useQuery({
    queryKey: ['admin-user-roles', drawerUid],
    queryFn: () => adminRoleApi.userRoles(drawerUid),
    enabled: !!drawerUid,
  });

  // 乐观更新禁用/启用：先改缓存，失败回滚（重新拉取）
  const setStatus = async (user, status) => {
    const prev = queryClient.getQueryData(['admin-accounts', params]);
    queryClient.setQueryData(['admin-accounts', params], (old) => ({
      ...old,
      items: (old?.items || []).map((it) => (it.uid === user.uid ? { ...it, status } : it)),
    }));
    try {
      await adminAccountApi.setStatus(user.uid, status);
      message.success(status === 1 ? t('admin.sys.accounts.disable_ok') : t('admin.sys.accounts.enable_ok'));
    } catch (err) {
      queryClient.setQueryData(['admin-accounts', params], prev);
      message.error(err.message);
    }
  };

  // 重置密码：强确认 Modal → 返回随机密码（仅展示一次，10s 自动清空）
  const doReset = async (user) => {
    try {
      const out = await adminAccountApi.resetPassword(user.uid);
      setResetPwd({ user, password: out.password });
      message.success(t('admin.sys.accounts.reset_done'));
      invalidate();
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setResetPwd(null), 10000);
    } catch (err) {
      message.error(err.message);
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(resetPwd.password);
      message.success(t('admin.sys.accounts.copied'));
    } catch {
      /* ignore */
    }
  };

  const columns = [
    {
      title: t('admin.sys.accounts.username'),
      dataIndex: 'username',
      width: 140,
      render: (v, row) => (
        <Space size={6}>
          <span>{v}</span>
          {row.uid === me?.uid && <Tag style={{ marginInlineEnd: 0 }}>{t('admin.sys.accounts.me')}</Tag>}
        </Space>
      ),
    },
    { title: t('admin.sys.accounts.name'), dataIndex: 'name', width: 120, ellipsis: true, render: (v) => v || '—' },
    { title: t('admin.sys.accounts.student_id'), dataIndex: 'student_id', width: 120, ellipsis: true, render: (v) => v || '—' },
    { title: t('admin.sys.accounts.phone'), dataIndex: 'phone', width: 130, render: (v) => v || '—' },
    { title: t('admin.sys.accounts.email'), dataIndex: 'email', width: 180, ellipsis: true, render: (v) => v || '—' },
    {
      title: t('admin.sys.accounts.status'),
      dataIndex: 'status',
      width: 90,
      render: (v) => (
        <Tag color={ACCOUNT_COLORS[v] ?? 'default'}>
          {v === 1 ? t('admin.sys.accounts.status_disabled') : t('admin.sys.accounts.status_normal')}
        </Tag>
      ),
    },
    {
      title: t('admin.sys.accounts.roles'),
      key: 'roles',
      width: 220,
      render: (_, row) => {
        const roles = row.roles || [];
        if (!roles.length) return <Text type="secondary">{t('admin.sys.accounts.roles_empty')}</Text>;
        const shown = roles.slice(0, 2);
        return (
          <Space size={4} wrap>
            {shown.map((r) => (
              <RoleTag key={r.role_id} roleId={r.role_id} roleName={r.role_name} />
            ))}
            {roles.length > 2 && <Tag>{`+${roles.length - 2}`}</Tag>}
          </Space>
        );
      },
    },
    { title: t('admin.sys.accounts.last_login'), dataIndex: 'last_login_at', width: 150, render: (v) => formatTime(v) },
    { title: t('admin.sys.accounts.created'), dataIndex: 'created_at', width: 150, render: (v) => formatTime(v) },
    {
      title: t('admin.sys.accounts.actions'),
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Tooltip title={t('admin.sys.accounts.view_roles')}>
            <Button type="text" size="small" icon={<SafetyCertificateOutlined />} onClick={() => setDrawerUid(row.uid)} />
          </Tooltip>
          {row.uid !== me?.uid && (
            row.status === 1 ? (
              <Popconfirm
                title={t('admin.sys.accounts.enable_confirm')}
                onConfirm={() => setStatus(row, 0)}
              >
                <Button type="link" size="small">{t('admin.sys.accounts.enable')}</Button>
              </Popconfirm>
            ) : (
              <Popconfirm
                title={t('admin.sys.accounts.disable_confirm')}
                okButtonProps={{ danger: true }}
                onConfirm={() => setStatus(row, 1)}
              >
                <Button type="link" size="small" danger>{t('admin.sys.accounts.disable')}</Button>
              </Popconfirm>
            )
          )}
          <Tooltip title={t('admin.sys.accounts.reset_pwd')}>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => Modal.confirm({
              title: t('admin.sys.accounts.reset_confirm'),
              okButtonProps: { danger: true },
              onOk: () => doReset(row),
            })} />
          </Tooltip>
          <Tooltip title={t('admin.sys.accounts.grant_hint')}>
            <Link to={`/admin/roles?uid=${row.uid}`}>
              <Button type="link" size="small">{t('admin.sys.accounts.grant')}</Button>
            </Link>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.accounts.title')}</Title>
          <Text type="secondary">{t('admin.sys.accounts.subtitle')}</Text>
        </div>
      </div>

      <Card>
        {/* 筛选栏：关键字 + 状态 */}
        <Form layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item>
            <Input
              allowClear
              autoFocus
              prefix={<SearchOutlined />}
              placeholder={t('admin.sys.accounts.keyword_ph')}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              style={{ width: 320 }}
            />
          </Form.Item>
          <Form.Item>
            <Select
              style={{ width: 140 }}
              value={filters.status}
              onChange={(v) => { setFilters((f) => ({ ...f, status: v })); setPage(1); }}
              options={[
                { value: '', label: t('admin.sys.accounts.status_all') },
                { value: 0, label: t('admin.sys.accounts.status_normal') },
                { value: 1, label: t('admin.sys.accounts.status_disabled') },
              ]}
            />
          </Form.Item>
        </Form>

        <Table
          rowKey="uid"
          size="middle"
          loading={isFetching}
          columns={columns}
          dataSource={items}
          rowClassName={(row) => (row.status === 1 ? 'sys-account-disabled' : '')}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50],
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.accounts.empty')} /> }}
        />
      </Card>

      {/* 查看角色抽屉 */}
      <Drawer
        open={!!drawerUid}
        title={t('admin.sys.accounts.view_roles_title')}
        width={480}
        onClose={() => setDrawerUid(null)}
      >
        {!rolesData?.items?.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.accounts.roles_empty')} />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {rolesData.items.map((r) => (
              <Card key={r.role_id} size="small">
                <Space size={8}>
                  <RoleTag roleId={r.role_id} roleName={r.role_name} />
                  <Text type="secondary">
                    {r.group_id == null ? t('admin.sys.role.full_scope') : t('admin.sys.role.scope', { name: r.group_name || `#${r.group_id}` })}
                  </Text>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>

      {/* 重置密码：一次性展示 + 10s 自动清空 */}
      <Modal
        open={!!resetPwd}
        title={t('admin.sys.accounts.reset_pwd')}
        width={480}
        footer={null}
        onCancel={() => setResetPwd(null)}
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {resetPwd?.user?.username} · {t('admin.sys.accounts.new_password_hint', { n: 10 })}
        </Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input.Password readOnly value={resetPwd?.password} style={{ fontFamily: 'monospace' }} />
          <Button icon={<CopyOutlined />} onClick={copyPassword}>
            {t('admin.sys.accounts.copy')}
          </Button>
        </Space.Compact>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" onClick={() => setResetPwd(null)}>
            <CheckOutlined /> {t('common.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
