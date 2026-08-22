import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Space, Typography, Breadcrumb, App as AntApp, theme } from 'antd';
import { UserOutlined, LogoutOutlined, HomeOutlined, DashboardOutlined } from '@ant-design/icons';
import { useAuthStore } from '../stores/auth.js';
import { authApi } from '../api/index.js';
import AppSettings from '../components/AppSettings.jsx';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const { Header, Sider, Content } = Layout;

// M5：管理端仅骨架（菜单 + 占位页），真实功能 M6/M7 落地
export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: antToken } = theme.useToken();
  useI18n();
  useDocumentTitle();

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

  const menuItems = [
    { key: '/admin', icon: <DashboardOutlined />, label: <Link to="/admin">{t('admin.overview')}</Link> },
    { key: '/admin/activities', icon: <HomeOutlined />, label: <Link to="/admin/activities">{t('admin.activities')}</Link> },
  ];
  const selected = menuItems.find((m) => location.pathname.startsWith(m.key))?.key;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={200}>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, textAlign: 'center', padding: '16px 0' }}>
          {t('brand.admin')}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected ?? '/admin']} items={menuItems} />
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
