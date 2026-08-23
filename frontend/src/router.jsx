import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AuthLayout from './layouts/AuthLayout.jsx';
import UserLayout from './layouts/UserLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import { RequireAuth, RequireAdmin, RequireSuperAdmin, GuestOnly, Forbidden, NotFound } from './guards/index.jsx';
import { useAuthStore } from './stores/auth.js';

// 页面级分包（React.lazy + Suspense）：auth / activities / 其余报名端页面 / admin（M6 管理端）
const Login = lazy(() => import('./pages/auth/Login.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.jsx'));
const Workbench = lazy(() => import('./pages/workbench/index.jsx'));
const Activities = lazy(() => import('./pages/activities/Activities.jsx'));
const ActivityDetail = lazy(() => import('./pages/activities/ActivityDetail.jsx'));
const RegisterForm = lazy(() => import('./pages/activities/RegisterForm.jsx'));
const MyRegistrations = lazy(() => import('./pages/my-registrations/index.jsx'));
const RegistrationDetail = lazy(() => import('./pages/my-registrations/Detail.jsx'));
const Notifications = lazy(() => import('./pages/notifications/index.jsx'));
const Profile = lazy(() => import('./pages/profile/index.jsx'));
// 管理端页面
const Dashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const AdminActivities = lazy(() => import('./pages/admin/Activities.jsx'));
const ActivityEdit = lazy(() => import('./pages/admin/ActivityEdit.jsx'));
const Templates = lazy(() => import('./pages/admin/Templates.jsx'));
const Registrations = lazy(() => import('./pages/admin/Registrations.jsx'));
const Review = lazy(() => import('./pages/admin/Review.jsx'));
const Checkin = lazy(() => import('./pages/admin/Checkin.jsx'));
const Stats = lazy(() => import('./pages/admin/Stats.jsx'));
// M7 系统管理页（懒加载，独立 chunk）
const GroupManager = lazy(() => import('./pages/admin/GroupManager.jsx'));
const AccountManager = lazy(() => import('./pages/admin/AccountManager.jsx'));
const RoleManager = lazy(() => import('./pages/admin/RoleManager.jsx'));
const SystemConfig = lazy(() => import('./pages/admin/SystemConfig.jsx'));
const AuditLogs = lazy(() => import('./pages/admin/AuditLogs.jsx'));
const Governance = lazy(() => import('./pages/admin/Governance.jsx'));

const fallback = (
  <div style={{ textAlign: 'center', padding: 64 }}>
    <Spin size="large" />
  </div>
);
const suspend = (el) => <Suspense fallback={fallback}>{el}</Suspense>;

// 报名端页面（全部需登录：未登录访问任意页面 → /login?redirect=当前路径）
const userPages = [
  { path: '/activities', element: suspend(<RequireAuth><Activities /></RequireAuth>) },
  { path: '/activities/:id', element: suspend(<RequireAuth><ActivityDetail /></RequireAuth>) },
  { path: '/activities/:id/register', element: suspend(<RequireAuth><RegisterForm /></RequireAuth>) },
  { path: '/my-registrations', element: suspend(<RequireAuth><MyRegistrations /></RequireAuth>) },
  { path: '/my-registrations/:rid', element: suspend(<RequireAuth><RegistrationDetail /></RequireAuth>) },
  { path: '/notifications', element: suspend(<RequireAuth><Notifications /></RequireAuth>) },
  { path: '/profile', element: suspend(<RequireAuth><Profile /></RequireAuth>) },
];

export const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: suspend(<GuestOnly><Login /></GuestOnly>) },
      { path: '/register', element: suspend(<GuestOnly><Register /></GuestOnly>) },
      { path: '/forgot-password', element: suspend(<GuestOnly><ForgotPassword /></GuestOnly>) },
    ],
  },
  {
    element: <UserLayout />,
    children: [
      { path: '/', element: <RootRedirect /> },
      { path: '/workbench', element: suspend(<RequireAuth><Workbench /></RequireAuth>) },
      ...userPages,
    ],
  },
  {
    path: '/admin',
    element: <RequireAdmin><AdminLayout /></RequireAdmin>,
    children: [
      { index: true, element: suspend(<Dashboard />) },
      { path: 'activities', element: suspend(<AdminActivities />) },
      { path: 'activities/new', element: suspend(<ActivityEdit />) },
      { path: 'activities/:id', element: suspend(<ActivityEdit />) },
      { path: 'activities/:id/registrations', element: suspend(<Registrations />) },
      { path: 'activities/:id/review', element: suspend(<Review />) },
      { path: 'activities/:id/checkin', element: suspend(<Checkin />) },
      { path: 'activities/:id/stats', element: suspend(<Stats />) },
      { path: 'templates', element: suspend(<Templates />) },
      // M7 系统管理（仅超管，RequireSuperAdmin 守卫；后端 403 兜底）
      { path: 'groups', element: suspend(<RequireSuperAdmin><GroupManager /></RequireSuperAdmin>) },
      { path: 'accounts', element: suspend(<RequireSuperAdmin><AccountManager /></RequireSuperAdmin>) },
      { path: 'roles', element: suspend(<RequireSuperAdmin><RoleManager /></RequireSuperAdmin>) },
      { path: 'system-config', element: suspend(<RequireSuperAdmin><SystemConfig /></RequireSuperAdmin>) },
      { path: 'audit-logs', element: suspend(<RequireSuperAdmin><AuditLogs /></RequireSuperAdmin>) },
      { path: 'governance', element: suspend(<RequireSuperAdmin><Governance /></RequireSuperAdmin>) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '/403', element: <Forbidden /> },
  { path: '*', element: <NotFound /> },
]);

function RootRedirect() {
  // 已登录 → 工作台；未登录 → 登录页（无公开页面）
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? '/workbench' : '/login'} replace />;
}
