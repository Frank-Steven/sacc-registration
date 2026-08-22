import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../api/index.js';

const STORAGE_KEY = 'sacc.auth';

// 客户端会话状态：登录 / 注册成功后写入，localStorage 持久化。
// 服务端数据（活动 / 报名 / 通知列表）一律走 TanStack Query，不入本 store。
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null, // { uid, username, name, student_id, college, phone, email, ... }
      setSession: ({ token, user }) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: STORAGE_KEY }
  )
);

// 启动校验：有 token 时向 /api/auth/me 确认会话有效并刷新资料
export async function hydrateAuth() {
  const { token } = useAuthStore.getState();
  if (!token) return;
  try {
    const user = await authApi.me();
    useAuthStore.setState({ user });
  } catch {
    // token 失效：拦截器已清会话并跳登录
  }
}
