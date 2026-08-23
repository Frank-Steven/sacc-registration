import { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Drawer, Button, Dropdown, Grid, Space, Typography, Breadcrumb, App as AntApp, theme } from 'antd';
import {
  MenuFoldOutlined, UserOutlined, LogoutOutlined, HomeOutlined, DashboardOutlined, FileTextOutlined, ToolOutlined,
  ApartmentOutlined, TeamOutlined, SafetyCertificateOutlined, SettingOutlined, FileSearchOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth.js';
import { authApi } from '../api/index.js';
import { adminRoleApi } from '../api/admin.js';
import AppSettings from '../components/AppSettings.jsx';
import PullToRefresh from '../components/PullToRefresh.jsx';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

const { Header, Sider, Content } = Layout;

// M6 管理端布局：菜单 = 概览 / 活动管理 / 模板（role 1/2）+ 活动运营子菜单（选中活动后）
export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const screens = Grid.useBreakpoint();
  // md 以下视为移动端（Sider breakpoint="lg" 已自动收起，此时用抽屉菜单）
  const isMobile = screens.lg === false;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token: antToken } = theme.useToken();
  const queryClient = useQueryClient();
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

  // roles 未就绪时不渲染权限相关菜单（避免非超管/非管理员首屏闪现无权菜单）
  const isManager = Array.isArray(roles) && roles.some((r) => r.role_id === 1 || r.role_id === 2);
  // M7：仅超级管理员渲染系统管理菜单（与 RequireSuperAdmin 守卫共用 ['my-roles'] 缓存）
  const isSuperAdmin = Array.isArray(roles) && roles.some((r) => r.role_id === 1);

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
  // M7 系统管理（D1）：三组静态展示，与活动选择无耦合；仅超管可见
  if (isSuperAdmin) {
    menuItems.push({
      key: 'sys-org',
      type: 'group',
      label: t('admin.sys.menu.group_org'),
      children: [
        { key: '/admin/groups', icon: <ApartmentOutlined />, label: <Link to="/admin/groups">{t('admin.sys.menu.groups')}</Link> },
        { key: '/admin/accounts', icon: <TeamOutlined />, label: <Link to="/admin/accounts">{t('admin.sys.menu.accounts')}</Link> },
        { key: '/admin/roles', icon: <SafetyCertificateOutlined />, label: <Link to="/admin/roles">{t('admin.sys.menu.roles')}</Link> },
      ],
    });
    menuItems.push({
      key: 'sys-system',
      type: 'group',
      label: t('admin.sys.menu.group_system'),
      children: [
        { key: '/admin/system-config', icon: <SettingOutlined />, label: <Link to="/admin/system-config">{t('admin.sys.menu.system_config')}</Link> },
        { key: '/admin/audit-logs', icon: <FileSearchOutlined />, label: <Link to="/admin/audit-logs">{t('admin.sys.menu.audit_logs')}</Link> },
      ],
    });
    menuItems.push({
      key: 'sys-data',
      type: 'group',
      label: t('admin.sys.menu.group_data'),
      children: [
        { key: '/admin/governance', icon: <DatabaseOutlined />, label: <Link to="/admin/governance">{t('admin.sys.menu.governance')}</Link> },
      ],
    });
  }

  const sub = match?.[2];
  const selected = sub ? `${opPrefix}/${sub}` : location.pathname;
  const openKeys = activityId ? [opPrefix] : [];

  return (
    <Layout className={isMobile ? 'app-shell' : undefined} style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={200}>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, textAlign: 'center', padding: '16px 0' }}>
          {t('brand.admin')}
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} defaultOpenKeys={openKeys} items={menuItems} />
      </Sider>
      <Layout style={{ minHeight: 0 }}>
        <Header style={{ background: antToken.colorBgContainer, paddingInline: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, position: 'sticky', top: 0, zIndex: 100 }}>
          <Space size={8} style={{ minWidth: 0 }}>
            {isMobile && (
              <Button
                type="text"
                aria-label={t('admin.menu.mobile_toggle')}
                icon={<MenuFoldOutlined style={{ fontSize: 18 }} />}
                onClick={() => setDrawerOpen(true)}
              />
            )}
            {!isMobile && <Breadcrumb items={[{ title: t('nav.admin') }]} />}
          </Space>
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
                <Avatar size="small" src={user?.avatar || undefined} style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
                {!isMobile && <Typography.Text>{user?.name || user?.username}</Typography.Text>}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content
          data-mob-scroll={isMobile ? '' : undefined}
          style={{
            padding: isMobile ? 12 : 24,
            // M9 移动端：内容区独立滚动，滚动条不与顶部栏重叠（外层 app-shell 锁定视口）
            flex: 1,
            minHeight: 0,
            overflowY: isMobile ? 'auto' : undefined,
            WebkitOverflowScrolling: isMobile ? 'touch' : undefined,
          }}
        >
          {/* M9：移动端布局级下拉刷新覆盖管理端所有页面；下拉触发全量失效重拉 */}
          {isMobile ? (
            <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
              <Outlet />
            </PullToRefresh>
          ) : (
            <Outlet />
          )}
        </Content>
      </Layout>

      {/* 移动端：抽屉全量菜单（含系统管理 3 组），点击菜单项后关闭 */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="left"
        width={240}
        closable={false}
        styles={{ body: { padding: 0, background: '#001529' } }}
      >
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, textAlign: 'center', padding: '16px 0' }}>
          {t('brand.admin')}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={({ key }) => {
            if (key.startsWith('/')) setDrawerOpen(false);
          }}
        />
      </Drawer>
    </Layout>
  );
}
