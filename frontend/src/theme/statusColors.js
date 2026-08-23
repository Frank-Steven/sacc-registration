// M7 3.1 / 3.4：全站状态色唯一出口——同一状态全站同色，禁止页面另造色值。
// 值均用 antd Tag 语义色（processing / success / warning / error / geekblue / orange / purple / default），
// 深浅主题由 antd token 自动适配，不做手工配色分支。

// 角色 Tag 色：1 超级管理员（红）/ 2 活动管理员（蓝）/ 3 审核员（灰）
export const ROLE_COLORS = Object.freeze({
  1: 'error',
  2: 'processing',
  3: 'default',
});

// 账号状态：0 正常 / 1 禁用
export const ACCOUNT_COLORS = Object.freeze({
  0: 'success',
  1: 'error',
});

// 备份状态：running / success / error
export const BACKUP_COLORS = Object.freeze({
  running: 'processing',
  success: 'success',
  error: 'error',
});

// 审计 action 分域色（3.4）：activity=processing / group=geekblue / form=purple /
// user_role=orange / system=default。按 action 命名归类（与后端 audit_log 调用一致）。
export const AUDIT_DOMAINS = Object.freeze({
  activity: 'processing',
  group: 'geekblue',
  form: 'purple',
  user_role: 'orange',
  system: 'default',
});

export function auditDomain(action) {
  if (!action) return 'system';
  // 活动相关：activity CRUD / 活动-分组绑定 / 模板套用 / 活动配置 / 报名审核·签到·导出
  if (/^(create|update|delete)_activity$/.test(action)) return 'activity';
  if (/^(bind|unbind)_group$/.test(action)) return 'activity';
  if (/(set_activity_config|apply_form_template|review_registration|checkin_registration|export_registration)$/.test(action)) return 'activity';
  // 分组相关
  if (/^(create|update|delete)_group$/.test(action)) return 'group';
  // 表单 / 字段 / 模板
  if (/^(create|update|delete)_(form|form_field|form_template)$/.test(action)) return 'form';
  // 授权 / 账号处置
  if (/^(grant|revoke)_role$/.test(action) || /^account\./.test(action)) return 'user_role';
  return 'system';
}
