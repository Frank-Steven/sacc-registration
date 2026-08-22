// 按域拆分的 API 模块：页面与 hooks 只依赖本层命名函数，不直接拼接 URL。
// 契约见 docs/frontend/portal.md 八（B1~B6）与 host/src/http/routes.js。
import { get, post, put, del } from './client.js';

export const authApi = {
  login: (data) => post('/auth/login', data),
  register: (data) => post('/auth/register', data),
  me: () => get('/auth/me'),
  logout: () => post('/auth/logout', {}),
  resetRequest: (data) => post('/auth/password/reset', data),
  resetConfirm: (data) => post('/auth/password/reset/confirm', data),
};

export const activityApi = {
  // B2：公开列表（分页 / keyword / activity_type / group_id 含子分组递归 / taken）
  publicList: (params) => get('/activities', params),
  // B1：公开详情（含 groups / forms[].fields[]）
  publicDetail: (id) => get(`/activities/${id}`),
  // 创建报名草稿（复用已取消记录；409 已报名）
  createRegistration: (id) => post(`/activities/${id}/registration`, {}),
};

export const groupApi = {
  // B3：公开分组树（非软删）
  publicTree: () => get('/groups/tree'),
};

export const registrationApi = {
  mine: (params) => get('/me/registrations', params),
  detail: (rid) => get(`/me/registrations/${rid}`),
  save: (rid, data) => put(`/me/registrations/${rid}`, data),
  submit: (rid) => post(`/me/registrations/${rid}/submit`, {}),
  cancel: (rid) => post(`/me/registrations/${rid}/cancel`, {}),
  checkin: (rid) => post(`/me/registrations/${rid}/checkin`, {}),
};

export const notificationApi = {
  mine: (params) => get('/me/notifications', params),
  unreadCount: () => get('/me/notifications/unread-count'),
  read: (nid) => put(`/me/notifications/${nid}/read`, {}),
  readAll: () => put('/me/notifications/read-all', {}),
};

export const subscribeApi = {
  mine: () => get('/me/subscribes'),
  add: (activityId) => post(`/me/subscribe/${activityId}`, {}),
  remove: (activityId) => del(`/me/subscribe/${activityId}`),
};

export const userApi = {
  // B4：基础资料
  updateProfile: (data) => put('/me/profile', data),
  // B5：常用信息（单条 upsert / 按 key 删除）
  commonInfoList: () => get('/me/common-info'),
  commonInfoSave: (data) => put('/me/common-info', data),
  commonInfoDelete: (key) => del('/me/common-info', { key }),
  // B6：通知偏好（按 notify_type 0~3 设置 / 删除恢复默认）
  notifyPrefList: () => get('/me/notify-prefs'),
  notifyPrefSet: (data) => put('/me/notify-prefs', data),
  notifyPrefDelete: (type) => del('/me/notify-prefs', { type }),
  // 界面偏好（theme/locale 服务端持久化，跨设备同步）
  prefsGet: () => get('/me/prefs'),
  prefsSet: (key, value) => put('/me/prefs', { pref_key: key, pref_value: value }),
};
