import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Breadcrumb, App as AntApp, theme } from 'antd';
import { UserOutlined, LogoutOutlined, HomeOutlined, DashboardOutlined, FileTextOutlined, ToolOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth.js';
import { authApi } from '../api/index.js';
import { adminRoleApi } from '../api/admin.js';
import AppSettings from '../components/AppSettings.jsx';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const { Header, Sider, Content } = Layout;

// M6 管理端布局：菜单 = 概览 / 活动管理 / 模板（role 1/2）+ 活动运营子菜单（选中活动后）
export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: antToken } = theme.useToken();
  const uid = useAuthStore((s) => s.user?.uid);
  const { data } = useQuery({
    queryKey: ['my-roles', uid],
    queryFn: () => adminRoleApi.myRoles(uid),
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
  });
  // user_role.list 返回 { items: [...] }
  const roles = data?.items;
  useI18n();
  useDocumentTitle();

  const isManager = !Array.isArray(roles) || roles.some((r) => r.role_id === 1 || r.role_id === 2);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    logout();
    message.success(t('auth.logout_success'));
    navigate('/login', { replace: true });
  };

  const match = location.pathname.match(/^\/admin\/activities\/(\d+)(?:\/(\w+))?/);
  const activityId = match?.[1];
  const opPrefix = activityId ? `/admin/activities/${activityId}` : '';

  const menuItems = [
    { key: '/admin', icon: <DashboardOutlined />, label: <Link to="/admin">{t('admin.menu.overview')}</Link> },
    { key: '/admin/activities', icon: <HomeOutlined />, label: <Link to="/admin/activities">{t('admin.menu.activities')}</Link> },
  ];
  if (isManager) {
    menuItems.push({
      key: '/admin/templates',
      icon: <FileTextOutlined />,
      label: <Link to="/admin/templates">{t('admin.menu.templates')}</Link>,
    });
  }
  if (activityId) {
    menuItems.push({
      key: opPrefix,
      icon: <ToolOutlined />,
      label: t('admin.menu.operations'),
      children: [
        { key: `${opPrefix}/registrations`, label: <Link to={`${opPrefix}/registrations`}>{t('admin.menu.roster')}</Link> },
        { key: `${opPrefix}/review`, label: <Link to={`${opPrefix}/review`}>{t('admin.menu.review')}</Link> },
        { key: `${opPrefix}/checkin`, label: <Link to={`${opPrefix}/checkin`}>{t('admin.menu.checkin')}</Link> },
        { key: `${opPrefix}/stats`, label: <Link to={`${opPrefix}/stats`}>{t('admin.menu.stats')}</Link> },
      ],
    });
  }

  const sub = match?.[2];
  const selected = sub ? `${opPrefix}/${sub}` : location.pathname;
  const openKeys = activityId ? [opPrefix] : [];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={200}>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, textAlign: 'center', padding: '16px 0' }}>
          {t('brand.admin')}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} defaultOpenKeys={openKeys} items={menuItems} />
      </Sider>
      <Layout>
        <Header style={{ background: antToken.colorBgContainer, paddingInline: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Breadcrumb items={[{ title: t('nav.admin') }]} />
          <Space size={8}>
            <AppSettings dark />
            <Dropdown
              menu={{
                items: [
                  { key: 'portal', label: <Link to="/workbench">{t('nav.back_portal')}</Link> },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: t('nav.logout') },
                ],
                onClick: ({ key }) => {
                  if (key === 'logout') handleLogout();
                },
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
                <Typography.Text>{user?.name || user?.username}</Typography.Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
