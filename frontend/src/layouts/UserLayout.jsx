import { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Badge, Dropdown, Avatar, Space, Typography, App as AntApp } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth.js';
import { useNotificationStore } from '../stores/notification.js';
import { notificationApi, authApi } from '../api/index.js';
import AppSettings from '../components/AppSettings.jsx';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const { Header, Content } = Layout;

function useUnreadPolling() {
  const setUnread = useNotificationStore((s) => s.setUnread);
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (!token) return undefined;
    let timer;
    const tick = async () => {
      try {
        const { count } = await notificationApi.unreadCount();
        setUnread(count);
      } catch {
        /* 401 已由拦截器处理；网络抖动忽略 */
      }
    };
    tick();
    timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [token, setUnread]);
}

export default function UserLayout() {
  const { token, user, logout } = useAuthStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  useUnreadPolling();
  useI18n();
  useDocumentTitle();

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      /* 无状态 JWT，登出失败也清本地 */
    }
    logout();
    message.success(t('auth.logout_success'));
    navigate('/login', { replace: true });
  };

  const nav = [
    { key: '/workbench', icon: <HomeOutlined />, label: <Link to="/workbench">{t('nav.workbench')}</Link> },
    { key: '/activities', icon: <UnorderedListOutlined />, label: <Link to="/activities">{t('nav.activities')}</Link> },
    { key: '/my-registrations', icon: <UserOutlined />, label: <Link to="/my-registrations">{t('nav.my_registrations')}</Link> },
    {
      key: '/notifications',
      icon: <Badge count={unreadCount} size="small" offset={[4, -4]}><BellOutlined /></Badge>,
      label: <Link to="/notifications">{t('nav.notifications')}</Link>,
    },
  ];
  // 高亮：报名表单 / 详情归入所属一级菜单
  const selected = [
    '/workbench', '/activities', '/my-registrations', '/notifications',
  ].find((k) => location.pathname === k || (k === '/activities' && location.pathname.startsWith('/activities')) || (k === '/my-registrations' && location.pathname.startsWith('/my-registrations')));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#001529', paddingInline: 16 }}>
        <Link to={token ? '/workbench' : '/activities'} style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginRight: 24, whiteSpace: 'nowrap' }}>
          {t('brand.portal')}
        </Link>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected ?? '']}
          items={nav}
          style={{ flex: 1, minWidth: 0 }}
        />
        <AppSettings dark />
        <Dropdown
          menu={{
            items: [
              { key: 'profile', icon: <SettingOutlined />, label: <Link to="/profile">{t('nav.profile')}</Link> },
              { key: 'admin', icon: <DashboardOutlined />, label: <Link to="/admin">{t('nav.admin')}</Link> },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: t('nav.logout') },
            ],
            onClick: ({ key }) => {
              if (key === 'logout') handleLogout();
            },
          }}
        >
          <Space style={{ color: '#fff', cursor: 'pointer' }}>
            <Avatar size="small" style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
            <Typography.Text style={{ color: '#fff' }}>{user?.name || user?.username || '未登录'}</Typography.Text>
          </Space>
        </Dropdown>
      </Header>
      <Content style={{ padding: 24, maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
