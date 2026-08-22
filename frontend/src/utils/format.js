import dayjs from 'dayjs';
import { t } from './i18n/index.js';

// 后端时间均为 Unix 秒（0 表示未设置）
export function formatTime(sec, pattern = 'YYYY-MM-DD HH:mm') {
  if (!sec || sec <= 0) return '—';
  return dayjs.unix(sec).format(pattern);
}

export function formatDate(sec) {
  return formatTime(sec, 'YYYY-MM-DD');
}

// 报名窗口文案：start/end 为 Unix 秒
export function windowText(start, end) {
  if (!start && !end) return t('time.unknown');
  if (!start) return t('time.deadline', { time: formatTime(end) });
  if (!end) return t('time.from', { time: formatTime(start) });
  return t('time.range', { start: formatTime(start), end: formatTime(end) });
}

// 距开始/截止的自然语言（大厅卡片辅助文案）
export function relativeWindow(start, end) {
  const now = dayjs();
  if (start > 0 && now.isBefore(dayjs.unix(start))) {
    const mins = dayjs.unix(start).diff(now, 'minute');
    const n = mins >= 60 ? `${dayjs.unix(start).diff(now, 'hour')}h` : `${mins}m`;
    return t('time.starts_in', { n });
  }
  if (end > 0 && now.isBefore(dayjs.unix(end))) {
    const mins = dayjs.unix(end).diff(now, 'minute');
    const n = mins >= 60 ? `${dayjs.unix(end).diff(now, 'hour')}h` : `${mins}m`;
    return t('time.ends_in', { n });
  }
  if (end > 0) return t('time.closed');
  return '';
}

// 名额进度：taken / max_slots（0 表示不限名额）
export function quotaPercent(taken, maxSlots) {
  if (!maxSlots || maxSlots <= 0) return null;
  return Math.min(100, Math.round((taken / maxSlots) * 100));
}
