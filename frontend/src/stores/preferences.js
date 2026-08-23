import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { userApi } from '../api/index.js';
import { useAuthStore } from './auth.js';

// 界面偏好：主题（light/dark）+ 语言（zh/en）。
// - 本地 localStorage 持久化保证即时响应；
// - 语言（M9）保留到用户数据：登录后写 user.lang（/api/me/profile），未登录仅本地；
// - 主题仍走 user_pref（/api/me/prefs）跨设备同步；
// - 登录后远端 theme 覆盖本地（applyRemotePrefs，不触发回写）。
export const usePreferencesStore = create(
  persist(
    (set) => ({
      theme: 'light',
      locale: 'zh',
      setTheme: (theme) => {
        set({ theme });
        syncPref('theme', theme);
      },
      toggleTheme: () => {
        const next = usePreferencesStore.getState().theme === 'dark' ? 'light' : 'dark';
        set({ theme: next });
        syncPref('theme', next);
      },
      setLocale: (locale) => {
        set({ locale });
        syncLocale(locale);
      },
      applyRemotePrefs: (prefs) => {
        const patch = {};
        if (prefs.theme === 'light' || prefs.theme === 'dark') patch.theme = prefs.theme;
        if (Object.keys(patch).length > 0) set(patch);
      },
    }),
    { name: 'sacc.preferences' }
  )
);

// 已登录时同步主题到服务端 user_pref（fire-and-forget；未登录仅本地保存）
function syncPref(key, value) {
  const token = useAuthStore.getState().token;
  if (!token) return;
  userApi.prefsSet(key, value).catch(() => {});
}

// 已登录时语言写入用户数据（user.lang，M9）；乐观更新会话 user 保持顶栏即时一致
function syncLocale(value) {
  const token = useAuthStore.getState().token;
  if (!token) return;
  userApi
    .updateProfile({ lang: value })
    .then(() => {
      const u = useAuthStore.getState().user;
      if (u && u.lang !== value) useAuthStore.setState({ user: { ...u, lang: value } });
    })
    .catch(() => {});
}
