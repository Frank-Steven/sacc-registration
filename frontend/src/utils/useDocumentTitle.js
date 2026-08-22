import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { t, useI18n } from './i18n/index.js';

// 路由 → 页面标题 key（浏览器标签页标题，随语言翻译，品牌 SACC 保留）
const RULES = [
  { re: /^\/activities\/[^/]+\/register/, key: 'brand.register_form' },
  { re: /^\/activities\/[^/]+/, key: 'brand.activities_detail' },
  { re: /^\/activities/, key: 'brand.activities' },
  { re: /^\/my-registrations/, key: 'brand.my_registrations' },
  { re: /^\/notifications/, key: 'brand.notifications' },
  { re: /^\/profile/, key: 'brand.profile' },
  { re: /^\/admin/, key: 'brand.admin_full' },
  { re: /^\/workbench/, key: 'brand.workbench' },
  { re: /^\/login|^\/register|^\/forgot-password/, key: 'brand.title' },
];

// 在布局/页面组件内调用：路由变化与语言变化时同步 document.title
export function useDocumentTitle() {
  const locale = useI18n();
  const { pathname } = useLocation();
  useEffect(() => {
    const rule = RULES.find((r) => r.re.test(pathname));
    document.title = t(rule ? rule.key : 'brand.title');
  }, [pathname, locale]);
}
