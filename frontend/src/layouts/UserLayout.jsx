import { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Badge, Dropdown, Avatar, Space, Typography, App as AntApp, Grid, theme } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth.js';
import { useNotificationStore } from '../stores/notification.js';
import { notificationApi, authApi } from '../api/index.js';
import AppSettings from '../components/AppSettings.jsx';
import PullToRefresh from '../components/PullToRefresh.jsx';
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
  const queryClient = useQueryClient();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const { token: antToken } = theme.useToken();
  // md 以下为移动端：顶部简导航 + 底部 TabBar（responsive-design.md 三）
  const isMobile = screens.lg === false;
  // 报名表单页隐藏 TabBar（底部固定操作条占位，避免遮挡「提交」按钮）
  const hideTabBar = /\/activities\/\d+\/register$/.test(location.pathname);
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

  // 移动端底部 TabBar 元素（工作台 / 活动大厅 / 我的报名 / 通知）；图标统一 20px 视觉一致
  const tabIconStyle = { fontSize: 20 };
  const tabBar = [
    { key: '/workbench', icon: <HomeOutlined style={tabIconStyle} />, label: t('nav.workbench') },
    { key: '/activities', icon: <UnorderedListOutlined style={tabIconStyle} />, label: t('nav.activities') },
    { key: '/my-registrations', icon: <UserOutlined style={tabIconStyle} />, label: t('nav.my_registrations') },
    {
      key: '/notifications',
      icon: (
        <Badge count={unreadCount} size="small">
          <BellOutlined style={tabIconStyle} />
        </Badge>
      ),
      label: t('nav.notifications'),
    },
  ];
  const tabBarEl = (
    <div
      style={{
        flexShrink: 0,
        background: antToken.colorBgContainer,
        borderTop: `1px solid ${antToken.colorSplit}`,
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabBar.map((tab) => {
        const active = selected === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(tab.key)}
            style={{
              flex: 1,
              minHeight: 52,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              color: active ? '#1677ff' : antToken.colorTextSecondary,
              fontSize: 11,
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Layout className={isMobile ? 'app-shell' : undefined} style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#001529',
          paddingInline: 16,
          gap: 12,
          flexShrink: 0,
          // M8：顶部栏固定定位常驻（内容滚动时保持可见）
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Link to={token ? '/workbench' : '/activities'} style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginRight: 'auto', whiteSpace: 'nowrap' }}>
          {t('brand.portal')}
        </Link>
        {!isMobile && (
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={[selected ?? '']}
            items={nav}
            style={{ flex: 1, minWidth: 0 }}
          />
        )}
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
            <Avatar size="small" src={user?.avatar || undefined} style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
            {!isMobile && (
              <Typography.Text style={{ color: '#fff' }}>{user?.name || user?.username || '未登录'}</Typography.Text>
            )}
          </Space>
        </Dropdown>
      </Header>

      {isMobile ? (
        // M9 移动端：视口固定（app-shell 锁定 100dvh），顶栏常驻、内容区独立滚动、
        // 底部 TabBar 布局内贴底 —— 滚动条只出现在内容区，不与顶/底栏重叠
        <div style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          <div
            data-mob-scroll
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}
          >
            {/* M9：布局级下拉刷新覆盖移动端所有页面；下拉触发全量失效重拉 */}
            <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
              <Content style={{ padding: 16, paddingBottom: 16 }}>
                <Outlet />
              </Content>
            </PullToRefresh>
          </div>
          {!hideTabBar && tabBarEl}
        </div>
      ) : (
        <Content
          style={{
            padding: 24,
            maxWidth: 960,
            margin: '0 auto',
            width: '100%',
          }}
        >
          <Outlet />
        </Content>
      )}
    </Layout>
  );
}
