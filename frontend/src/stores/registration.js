import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 分步报名草稿：表单值 + 当前步骤，localStorage 持久化；
// 再次进入报名表单时恢复（「继续上次填写」），提交成功清空。
export const useRegistrationStore = create(
  persist(
    (set) => ({
      activityId: null,
      registrationId: null,
      formValues: {}, // { field_key: value }（跨步骤合并）
      currentStep: 0,
      saveDraft: ({ activityId, registrationId, formValues, currentStep }) =>
        set({ activityId, registrationId, formValues, currentStep }),
      clearDraft: () => set({ activityId: null, registrationId: null, formValues: {}, currentStep: 0 }),
    }),
    { name: 'sacc.registration-draft' }
  )
);
