import { Navigate, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
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
