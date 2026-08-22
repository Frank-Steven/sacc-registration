import { create } from 'zustand';

// 通知未读角标：由顶栏轮询更新，单条/全部已读后由页面驱动递减/清零
export const useNotificationStore = create((set) => ({
  unreadCount: 0,
  setUnread: (count) => set({ unreadCount: count }),
  decrement: (n = 1) =>
    set((s) => ({ unreadCount: Math.max(0, s.unreadCount - n) })),
  clear: () => set({ unreadCount: 0 }),
}));
