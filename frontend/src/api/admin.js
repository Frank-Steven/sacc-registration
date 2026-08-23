// 管理端 API（M6）：契约见 docs/frontend/admin.md 四 与 host/src/http/routes.js。
// 统一响应 { code, data, message }，client.js 拦截器已解包；写操作会写 audit_log（后端）。
import { get, post, put, del } from './client.js';

// 活动管理
export const adminActivityApi = {
  list: (params) => get('/admin/activities', params),
  create: (data) => post('/admin/activities', data),
  detail: (id) => get(`/admin/activities/${id}`),
  update: (id, data) => put(`/admin/activities/${id}`, data),
  remove: (id) => del(`/admin/activities/${id}`),
  // M4 跨活动统计（须先于 /admin/activities/:id 注册，宿主已处理）
  stats: (params) => get('/admin/activities/stats', params),
  // 分组绑定
  bindGroup: (id, groupId) => post(`/admin/activities/${id}/groups/${groupId}`, {}),
  unbindGroup: (id, groupId) => del(`/admin/activities/${id}/groups/${groupId}`),
  // 活动配置（键值类型化，见 admin/ConfigEditor）
  configList: (id) => get(`/admin/activities/${id}/config`),
  configSet: (id, data) => put(`/admin/activities/${id}/config`, data),
};

export const adminGroupApi = {
  tree: () => get('/admin/groups/tree'),
};

// 表单 / 字段（活动编辑内 FormDesigner）
export const adminFormApi = {
  create: (activityId, data) => post(`/admin/activities/${activityId}/forms`, data),
  update: (formId, data) => put(`/admin/forms/${formId}`, data),
  remove: (formId) => del(`/admin/forms/${formId}`),
  fieldCreate: (formId, data) => post(`/admin/forms/${formId}/fields`, data),
  fieldUpdate: (fieldId, data) => put(`/admin/fields/${fieldId}`, data),
  fieldDelete: (fieldId) => del(`/admin/fields/${fieldId}`),
};

// 模板
export const adminTemplateApi = {
  list: () => get('/admin/templates'),
  create: (data) => post('/admin/templates', data),
  update: (id, data) => put(`/admin/templates/${id}`, data),
  remove: (id) => del(`/admin/templates/${id}`),
  apply: (id, activityId) => post(`/admin/templates/${id}/apply`, { activity_id: activityId }),
  // 宿主补充路由（wasm op form_template.save_from_activity 已存在）
  saveFromActivity: (activityId, name) => post(`/admin/activities/${activityId}/templates`, { name }),
};

// 报名运营（名单 / 审核 / 签到）
export const adminRosterApi = {
  list: (activityId, params) => get(`/admin/activities/${activityId}/registrations`, params),
  detail: (rid) => get(`/admin/registrations/${rid}`),
  review: (rid, data) => post(`/admin/registrations/${rid}/review`, data),
  checkinById: (rid) => post(`/admin/registrations/${rid}/checkin`, {}),
  checkinByReceipt: (receiptNo) => post('/admin/checkin/receipt', { receipt_no: receiptNo }),
  checkinCode: (activityId) => get(`/admin/activities/${activityId}/checkin-code`),
  // M4 分块导出（cursor 游标）
  exportChunk: (activityId, params) => get(`/admin/activities/${activityId}/export`, params),
};

// 统计
export const adminStatsApi = {
  registrationStats: (activityId) => get(`/admin/activities/${activityId}/stats`),
  trend: (activityId, days) => get(`/admin/activities/${activityId}/trend`, { days }),
};

// 角色（前端据此控制按钮显隐；auth.me 不含角色）
export const adminRoleApi = {
  myRoles: (uid) => get(`/admin/users/${uid}/roles`),
};

// CSV 下载：宿主返回 raw CSV（Content-Disposition），不能走 JSON 拦截器
export async function downloadCsv(activityId, params = {}) {
  let token = '';
  try {
    token = JSON.parse(localStorage.getItem('sacc.auth') || '{}')?.state?.token || '';
  } catch {
    /* ignore */
  }
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const url = `/api/admin/activities/${activityId}/export.csv${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      /* 非 JSON */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `registrations_${activityId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
