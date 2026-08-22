import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { userApi } from '../api/index.js';
import { useAuthStore } from './auth.js';

// 界面偏好：主题（light/dark）+ 语言（zh/en）。
// - 本地 localStorage 持久化保证即时响应；
// - 登录后单条变更同步到服务端（/api/me/prefs），跨设备保持；
// - 登录后远端值优先覆盖本地（applyRemotePrefs，不触发回写）。
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
        syncPref('locale', locale);
      },
      applyRemotePrefs: (prefs) => {
        const patch = {};
        if (prefs.theme === 'light' || prefs.theme === 'dark') patch.theme = prefs.theme;
        if (prefs.locale === 'zh' || prefs.locale === 'en') patch.locale = prefs.locale;
        if (Object.keys(patch).length > 0) set(patch);
      },
    }),
    { name: 'sacc.preferences' }
  )
);

// 已登录时同步单条偏好到服务端（fire-and-forget；未登录仅本地保存）
function syncPref(key, value) {
  const token = useAuthStore.getState().token;
  if (!token) return;
  userApi.prefsSet(key, value).catch(() => {});
}
