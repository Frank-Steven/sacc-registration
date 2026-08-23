import { Navigate, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/auth.js';
import { adminRoleApi } from '../api/admin.js';
import { t, useI18n } from '../utils/i18n/index.js';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

// 需登录：未登录 → /login?redirect=当前路径（登录后回跳）
export function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  if (!token) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  return children;
}

// 管理端：未登录 → 登录页；无管理角色（1 超管 / 2 活动管理员 / 3 审核员）→ 403
export function RequireAdmin({ children }) {
  const token = useAuthStore((s) => s.token);
  const uid = useAuthStore((s) => s.user?.uid);
  const location = useLocation();
  const { data } = useQuery({
    queryKey: ['my-roles', uid],
    queryFn: () => adminRoleApi.myRoles(uid),
    enabled: !!token && !!uid,
    staleTime: 5 * 60 * 1000,
  });
  // user_role.list 返回 { items: [...] }
  const roles = data?.items;
  if (!token) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }
  // roles 未就绪（undefined）时先放行；已就绪且不含任何管理角色（含空列表）→ 403
  if (Array.isArray(roles) && !roles.some((r) => [1, 2, 3].includes(r.role_id))) {
    return <Navigate to="/403" replace />;
  }
  return children;
}

// 仅游客：已登录访问登录/注册页 → 工作台
export function GuestOnly({ children }) {
  const token = useAuthStore((s) => s.token);
  if (token) return <Navigate to="/workbench" replace />;
  return children;
}

export function NotFound() {
  useI18n();
  useDocumentTitle();
  return (
    <Result
      status="404"
      title="404"
      subTitle={t('guard.404')}
      extra={
        <Link to="/activities">
          <Button type="primary">{t('guard.back_activities')}</Button>
        </Link>
      }
    />
  );
}

export function Forbidden() {
  useI18n();
  return (
    <Result
      status="403"
      title="403"
      subTitle={t('guard.403')}
      extra={
        <Link to="/workbench">
          <Button type="primary">{t('guard.back_workbench')}</Button>
        </Link>
      }
    />
  );
}
