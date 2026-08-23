import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { App, Button, Card, Checkbox, Drawer, Empty, Form, Popconfirm, Select, Space, Spin, Table, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAccountApi, adminRoleApi } from '../../api/admin.js';
import RoleTag from '../../components/RoleTag.jsx';
import GroupTreeSelect from '../../components/GroupTreeSelect.jsx';
import { t, useI18n } from '../../utils/i18n/index.js';
import { useDocumentTitle } from '../../utils/useDocumentTitle.js';

const { Text, Title } = Typography;

// D4 能力矩阵（本地静态映射，与后端 config.md 1.3 一致）：角色 → 能力
const CAPABILITY_MATRIX = [
  { key: 'cap_activity', roles: [1, 2] },
  { key: 'cap_form', roles: [1, 2] },
  { key: 'cap_roster', roles: [1, 2] },
  { key: 'cap_review', roles: [1, 2, 3] },
  { key: 'cap_checkin', roles: [1, 2, 3] },
  { key: 'cap_stats', roles: [1, 2] },
  { key: 'cap_system', roles: [1] },
];

// 角色授权（M7 九，旅程 A）：选人 → 看现有授权 → 添加（角色 + 范围）→ 权限预览确认
export default function RoleManager() {
  useI18n();
  useDocumentTitle();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [user, setUser] = useState(null); // { uid, username, name }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [continueNext, setContinueNext] = useState(false);
  const [form] = Form.useForm();
  const [searchKw, setSearchKw] = useState('');
  const watchRoleId = Form.useWatch('role_id', form);

  // ?uid= 直达预选（账号管理「授权」跳转）：仅知 uid，名称回退显示
  const uidParam = Number(params.get('uid')) || null;
  const selectedUid = user?.uid ?? uidParam;

  // 用户搜索（复用 B1，服务端过滤）
  const { data: userData, isFetching: userFetching } = useQuery({
    queryKey: ['role-user-search', searchKw],
    queryFn: () => adminAccountApi.adminList({ keyword: searchKw, page_size: 10 }),
    enabled: !!searchKw,
    staleTime: 30_000,
  });
  const userOptions = (userData?.items || []).map((u) => ({
    value: u.uid,
    label: `${u.username}${u.name ? ` · ${u.name}` : ''}`,
    user: u,
  }));

  // 当前用户角色
  const { data: rolesData, isFetching: rolesFetching } = useQuery({
    queryKey: ['admin-user-roles', selectedUid],
    queryFn: () => adminRoleApi.userRoles(selectedUid),
    enabled: !!selectedUid,
  });
  const roles = rolesData?.items || [];

  // 角色下拉（role.list）
  const { data: roleData } = useQuery({ queryKey: ['admin-roles'], queryFn: adminRoleApi.roleList, staleTime: 5 * 60 * 1000 });
  const roleOptions = (roleData?.items || []).map((r) => ({ value: r.role_id, label: r.name }));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-user-roles', selectedUid] });

  // 权限预览：本地计算（D4）
  const preview = useMemo(() => {
    const roleIds = new Set(roles.map((r) => r.role_id));
    const caps = {};
    CAPABILITY_MATRIX.forEach((c) => { caps[c.key] = c.roles.some((rid) => roleIds.has(rid)); });
    if (roleIds.has(1)) {
      return { isSuper: true, scopeTexts: [t('admin.sys.roles.super_admin')], caps };
    }
    const scopeTexts = roles.map((r) => {
      const label = t(`admin.sys.role.${r.role_id}`);
      if (r.group_id == null) return `${label} · ${t('admin.sys.role.full_scope')}`;
      return `${label} · ${t('admin.sys.role.scope_with_children', { name: r.group_name || `#${r.group_id}` })}`;
    });
    return { isSuper: false, scopeTexts, caps };
  }, [roles]);

  const handleGrant = async () => {
    const values = await form.validateFields();
    const roleId = values.role_id;
    try {
      // role 1 超管忽略分组范围（后端同样忽略）
      const groupId = roleId === 1 ? null : (values.group_id ?? null);
      await adminRoleApi.grant(roleId, { target_uid: selectedUid, group_id: groupId });
      message.success(t('admin.sys.roles.grant_ok'));
      invalidate();
      if (continueNext) {
        form.resetFields();
      } else {
        setDrawerOpen(false);
        form.resetFields();
      }
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleRevoke = async (role) => {
    try {
      await adminRoleApi.revoke(selectedUid, role.role_id);
      message.success(t('admin.sys.roles.remove_ok'));
      invalidate();
    } catch (err) {
      message.error(err.message);
    }
  };

  const previewColumns = [
    {
      title: '',
      key: 'cap',
      dataIndex: 'key',
      render: (k) => t(`admin.sys.roles.${k}`),
    },
    {
      title: '',
      key: 'ok',
      width: 80,
      align: 'center',
      render: (_, row) =>
        preview.caps[row.key] ? (
          <CheckOutlined style={{ color: '#52c41a' }} />
        ) : (
          <CloseOutlined style={{ color: 'rgba(0,0,0,0.25)' }} />
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 600 }}>{t('admin.sys.roles.title')}</Title>
          <Text type="secondary">{t('admin.sys.roles.subtitle')}</Text>
        </div>
      </div>

      <Card>
        {/* 用户选择 */}
        <Form layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item label={<UserOutlined />} style={{ marginBottom: 0 }}>
            <Select
              showSearch
              style={{ width: 340 }}
              placeholder={t('admin.sys.roles.user_ph')}
              filterOption={false}
              loading={userFetching}
              value={selectedUid}
              onSearch={(kw) => setSearchKw(kw.trim())}
              onChange={(uid) => {
                const u = userOptions.find((o) => o.value === uid)?.user;
                setUser(u ? { uid: u.uid, username: u.username, name: u.name } : { uid, username: `#${uid}`, name: '' });
                setParams({}, { replace: true });
              }}
              options={userOptions}
              notFoundContent={searchKw ? undefined : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.roles.user_required')} />}
            />
          </Form.Item>
        </Form>

        {!selectedUid ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.sys.roles.empty_user')} />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 当前角色 */}
            <div>
              <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text strong>{t('admin.sys.roles.current_roles')}</Text>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setDrawerOpen(true); }}>
                  {t('admin.sys.roles.add_role')}
                </Button>
              </Space>
              {rolesFetching ? (
                <div style={{ textAlign: 'center', padding: 16 }}><Spin /></div>
              ) : roles.length === 0 ? (
                <Text type="secondary">{t('admin.sys.roles.no_roles')}</Text>
              ) : (
                <Table
                  rowKey="role_id"
                  size="small"
                  pagination={false}
                  dataSource={roles}
                  columns={[
                    {
                      title: t('admin.sys.roles.role_desc'),
                      dataIndex: 'role_id',
                      render: (v, r) => <RoleTag roleId={v} roleName={r.role_name} />,
                    },
                    {
                      title: t('admin.sys.roles.scope_desc'),
                      key: 'scope',
                      render: (_, r) =>
                        r.group_id == null ? (
                          <Text>{t('admin.sys.role.full_scope')}</Text>
                        ) : (
                          <Text type="secondary">{t('admin.sys.role.scope_with_children', { name: r.group_name || `#${r.group_id}` })}</Text>
                        ),
                    },
                    {
                      title: '',
                      key: 'op',
                      width: 90,
                      align: 'right',
                      render: (_, r) => (
                        <Popconfirm
                          title={t('admin.sys.roles.remove_confirm')}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => handleRevoke(r)}
                        >
                          <Button type="link" size="small" danger>{t('admin.sys.roles.remove')}</Button>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              )}
            </div>

            {/* 权限预览 */}
            <Card size="small" title={t('admin.sys.roles.preview')}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                {t('admin.sys.roles.preview_hint')}
              </Text>
              {preview.scopeTexts.length === 0 ? (
                <Text type="secondary">{t('admin.sys.roles.no_roles')}</Text>
              ) : (
                <>
                  <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
                    {preview.scopeTexts.map((s, i) => (
                      <Text key={i}>{s}</Text>
                    ))}
                  </Space>
                  <Table
                    rowKey="key"
                    size="small"
                    pagination={false}
                    columns={previewColumns}
                    dataSource={CAPABILITY_MATRIX}
                  />
                </>
              )}
            </Card>
          </Space>
        )}
      </Card>

      {/* 添加授权抽屉 */}
      <Drawer
        open={drawerOpen}
        title={t('admin.sys.roles.grant_title')}
        width={440}
        onClose={() => setDrawerOpen(false)}
        destroyOnClose
        extra={
          <Link to={`/admin/accounts?keyword=${encodeURIComponent(user?.username || '')}`}>
            <Text type="secondary">{user?.username}</Text>
          </Link>
        }
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Checkbox checked={continueNext} onChange={(e) => setContinueNext(e.target.checked)}>
              {t('admin.sys.roles.grant_another')}
            </Checkbox>
            <Space>
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button type="primary" onClick={handleGrant}>{t('common.save')}</Button>
            </Space>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="role_id"
            label={t('admin.sys.roles.role')}
            rules={[{ required: true, message: t('admin.sys.roles.role_required') }]}
          >
            <Select
              placeholder={t('admin.sys.roles.role_required')}
              options={roleOptions}
              onChange={() => form.setFieldValue('group_id', undefined)}
            />
          </Form.Item>
          {watchRoleId !== 1 && (
            <Form.Item
              name="group_id"
              label={t('admin.sys.roles.scope_tree')}
              extra={t('admin.sys.roles.scope_all')}
            >
              <GroupTreeSelect single />
            </Form.Item>
          )}
          {watchRoleId === 1 && (
            <Text type="secondary" style={{ display: 'block' }}>
              {t('admin.sys.roles.super_admin')}
            </Text>
          )}
        </Form>
      </Drawer>
    </div>
  );
}
