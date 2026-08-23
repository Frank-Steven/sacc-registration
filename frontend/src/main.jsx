import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { RouterProvider } from 'react-router-dom';
import { router } from './router.jsx';
import { hydrateAuth, useAuthStore } from './stores/auth.js';
import { usePreferencesStore } from './stores/preferences.js';
import { userApi } from './api/index.js';
import './index.css';

dayjs.locale('zh-cn');

// QueryClient：默认 2 次指数退避重试；401/403 不重试；活动详情/分组树/表单字段长缓存
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if ([401, 403].includes(error?.code)) return false;
        return failureCount < 2;
      },
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      // 全站实时刷新：页面可见时每 15s 自动拉取最新状态（通知/名额/审核/签到/看板等联动）
      refetchInterval: 15_000,
    },
  },
});

// 响应偏好（深浅主题 / 语言）的 Provider 组装
function AppProviders() {
  const theme = usePreferencesStore((s) => s.theme);
  const locale = usePreferencesStore((s) => s.locale);
  const token = useAuthStore((s) => s.token);
  const applyRemotePrefs = usePreferencesStore((s) => s.applyRemotePrefs);

  // 已登录：从服务端拉取界面偏好（theme/locale）并覆盖本地（跨设备同步）
  useQuery({
    queryKey: ['me-prefs'],
    enabled: Boolean(token),
    queryFn: async () => {
      const { items } = await userApi.prefsGet();
      const prefs = Object.fromEntries(items.map((i) => [i.pref_key, i.pref_value]));
      applyRemotePrefs(prefs);
      return items;
    },
  });

  // 同步 CSS 变量（body 背景等非 antd 样式的暗色适配）
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <ConfigProvider
      locale={locale === 'en' ? enUS : zhCN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#1677ff', borderRadius: 6 },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}

// 启动时校验本地会话（token → /api/auth/me），完成后才挂载路由。
// QueryClientProvider 在 AppProviders 外层：AppProviders 内可直接使用 useQuery。
hydrateAuth().finally(() => {
  createRoot(document.getElementById('root')).render(
    <QueryClientProvider client={queryClient}>
      <AppProviders />
    </QueryClientProvider>
  );
});
