import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AuthLayout from './layouts/AuthLayout.jsx';
import UserLayout from './layouts/UserLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import { RequireAuth, GuestOnly, Forbidden, NotFound } from './guards/index.jsx';
import { useAuthStore } from './stores/auth.js';

// 页面级分包（React.lazy + Suspense）：auth / activities / 其余报名端页面 / admin 占位
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
const AdminPlaceholder = lazy(() => import('./pages/admin/index.jsx'));

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
    element: <RequireAuth><AdminLayout /></RequireAuth>,
    children: [
      { index: true, element: suspend(<AdminPlaceholder />) },
      { path: '*', element: suspend(<AdminPlaceholder />) },
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
