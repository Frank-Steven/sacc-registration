import { usePreferencesStore } from '../../stores/preferences.js';
import { common } from './common.js';
import { layouts } from './layouts.js';
import { activities } from './activities.js';
import { mine } from './mine.js';

// 合并全部域字典：{ key: { zh, en } }
export const dict = { ...common, ...layouts, ...activities, ...mine };

// 翻译：按当前偏好语言取词；支持 {var} 占位符替换
export function t(key, vars) {
  const locale = usePreferencesStore.getState().locale;
  const entry = dict[key];
  const text = entry ? entry[locale] ?? entry.zh ?? key : key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// 组件内订阅语言，locale 变化时触发重渲染（t 内部始终读取最新偏好）
export function useI18n() {
  return usePreferencesStore((s) => s.locale);
}
