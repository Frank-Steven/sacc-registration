// API 路由：method + path → handler(ctx) → { code, data?, message? }
// - pattern 支持 RegExp（M1）与字符串路径（含 :param，M2 起，命中注入 ctx.params）
// - ctx = { query, body, headers, params }（server.js 注入）
// - 管理端统一 /api/admin/*：宿主校验 JWT 后透传 uid 入 wasm，权限判定在 wasm 内
import { Errors } from '../errors.js';
import { signJwt, verifyJwt, bearerToken } from '../auth/jwt.js';

// 解析 Bearer token 并校验，返回 { uid, username }；无效返回 null
function requireAuth(ctx, config) {
  if (!config.jwtSecret) return null;
  const payload = verifyJwt(bearerToken(ctx.headers), config.jwtSecret);
  return payload && Number.isInteger(payload.uid) ? payload : null;
}

export function createRoutes({ runtime, config }) {
  const issueToken = (user) => ({
    token: signJwt({ uid: user.uid, username: user.username }, config.jwtSecret),
    user,
  });

  // 管理端 handler 工厂：JWT 鉴权 → args = body + query + path 参数映射 + uid
  const admin = (op, pathMap = {}) => async (ctx) => {
    const auth = requireAuth(ctx, config);
    if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
    const args = { ...ctx.body, ...Object.fromEntries(ctx.query || []), uid: auth.uid };
    for (const [argKey, paramName] of Object.entries(pathMap)) {
      const v = ctx.params?.[paramName];
      if (v !== undefined) args[argKey] = Number(v);
    }
    return runtime.invoke({ op, args });
  };

  return [
    {
      method: 'GET',
      pattern: /^\/api\/health$/,
      handler: () => runtime.invoke({ op: 'ping' }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/version$/,
      handler: () => runtime.invoke({ op: 'sys.version' }),
    },
    {
      method: 'GET',
      pattern: /^\/api\/system\/status$/,
      handler: async () => {
        const uv = await runtime.invoke({ op: 'db.user_version' });
        const tables = await runtime.invoke({ op: 'db.tables' });
        return {
          code: 0,
          data: {
            wasm: runtime.version,
            user_version: uv.code === Errors.OK ? uv.data?.user_version : undefined,
            tables: tables.code === Errors.OK ? tables.data?.tables : undefined,
          },
        };
      },
    },

    // ---------- 认证（M1） ----------
    {
      method: 'POST',
      pattern: /^\/api\/auth\/register$/,
      handler: async (ctx) => {
        const out = await runtime.invoke({ op: 'auth.register', args: ctx.body });
        if (out.code !== Errors.OK) return out;
        return { code: 0, data: issueToken(out.data) };
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/auth\/login$/,
      handler: async (ctx) => {
        const out = await runtime.invoke({ op: 'auth.login', args: ctx.body });
        if (out.code !== Errors.OK) return out;
        return { code: 0, data: issueToken(out.data) };
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/auth\/me$/,
      handler: async (ctx) => {
        const auth = requireAuth(ctx, config);
        if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
        return runtime.invoke({ op: 'auth.me', args: { uid: auth.uid } });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/auth\/logout$/,
      handler: () => ({ code: 0, data: { ok: true } }), // 无状态 JWT：客户端删除 token 即可
    },
    {
      method: 'POST',
      pattern: /^\/api\/auth\/password\/reset$/,
      handler: (ctx) => runtime.invoke({ op: 'auth.reset_request', args: ctx.body }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/auth\/password\/reset\/confirm$/,
      handler: (ctx) => runtime.invoke({ op: 'auth.reset_confirm', args: ctx.body }),
    },

    // ---------- 管理端（M2：配置层与权限，需 JWT） ----------
    // 活动
    { method: 'GET', pattern: '/api/admin/activities', handler: admin('activity.list') },
    { method: 'POST', pattern: '/api/admin/activities', handler: admin('activity.create') },
    { method: 'GET', pattern: '/api/admin/activities/:id', handler: admin('activity.detail', { activity_id: 'id' }) },
    { method: 'PUT', pattern: '/api/admin/activities/:id', handler: admin('activity.update', { activity_id: 'id' }) },
    { method: 'DELETE', pattern: '/api/admin/activities/:id', handler: admin('activity.delete', { activity_id: 'id' }) },
    // 表单 / 字段
    { method: 'GET', pattern: '/api/admin/activities/:id/forms', handler: admin('activity.detail', { activity_id: 'id' }) },
    { method: 'POST', pattern: '/api/admin/activities/:id/forms', handler: admin('form.create', { activity_id: 'id' }) },
    { method: 'PUT', pattern: '/api/admin/forms/:id', handler: admin('form.update', { form_id: 'id' }) },
    { method: 'DELETE', pattern: '/api/admin/forms/:id', handler: admin('form.delete', { form_id: 'id' }) },
    { method: 'GET', pattern: '/api/admin/forms/:id/fields', handler: admin('form.detail', { form_id: 'id' }) },
    { method: 'POST', pattern: '/api/admin/forms/:id/fields', handler: admin('form_field.create', { form_id: 'id' }) },
    { method: 'PUT', pattern: '/api/admin/fields/:id', handler: admin('form_field.update', { field_id: 'id' }) },
    { method: 'DELETE', pattern: '/api/admin/fields/:id', handler: admin('form_field.delete', { field_id: 'id' }) },
    // 分组 / 活动绑定
    { method: 'GET', pattern: '/api/admin/groups/tree', handler: admin('group.tree') },
    { method: 'POST', pattern: '/api/admin/groups', handler: admin('group.create') },
    { method: 'PUT', pattern: '/api/admin/groups/:id', handler: admin('group.update', { group_id: 'id' }) },
    { method: 'DELETE', pattern: '/api/admin/groups/:id', handler: admin('group.delete', { group_id: 'id' }) },
    { method: 'POST', pattern: '/api/admin/activities/:id/groups/:groupId', handler: admin('activity_group.bind', { activity_id: 'id', group_id: 'groupId' }) },
    { method: 'DELETE', pattern: '/api/admin/activities/:id/groups/:groupId', handler: admin('activity_group.unbind', { activity_id: 'id', group_id: 'groupId' }) },
    // 配置
    { method: 'GET', pattern: '/api/admin/activities/:id/config', handler: admin('activity_config.list', { activity_id: 'id' }) },
    { method: 'PUT', pattern: '/api/admin/activities/:id/config', handler: admin('activity_config.set', { activity_id: 'id' }) },
    { method: 'GET', pattern: '/api/admin/system/config', handler: admin('system_config.list') },
    { method: 'PUT', pattern: '/api/admin/system/config', handler: admin('system_config.set') },
    // 模板
    { method: 'GET', pattern: '/api/admin/templates', handler: admin('form_template.list') },
    { method: 'POST', pattern: '/api/admin/templates', handler: admin('form_template.create') },
    { method: 'PUT', pattern: '/api/admin/templates/:id', handler: admin('form_template.update', { template_id: 'id' }) },
    { method: 'DELETE', pattern: '/api/admin/templates/:id', handler: admin('form_template.delete', { template_id: 'id' }) },
    { method: 'POST', pattern: '/api/admin/templates/:id/apply', handler: admin('form_template.apply', { template_id: 'id' }) },
    // 角色 / 授权 / 审计（user_role.list 按目标用户查询，route 语义见 config.md 2.2）
    { method: 'GET', pattern: '/api/admin/roles', handler: admin('role.list') },
    { method: 'GET', pattern: '/api/admin/users/:uid/roles', handler: admin('user_role.list', { target_uid: 'uid' }) },
    { method: 'POST', pattern: '/api/admin/roles/:roleId/users', handler: admin('user_role.grant', { role_id: 'roleId' }) },
    { method: 'DELETE', pattern: '/api/admin/user-roles/:uid/:roleId', handler: admin('user_role.revoke', { target_uid: 'uid', role_id: 'roleId' }) },
    { method: 'GET', pattern: '/api/admin/audit-logs', handler: admin('audit_log.list') },

    // ---------- 报名端（公开只读，M2） ----------
    {
      method: 'GET',
      pattern: '/api/activities',
      handler: (ctx) =>
        runtime.invoke({ op: 'activity.public_list', args: Object.fromEntries(ctx.query || []) }),
    },
    {
      method: 'GET',
      pattern: '/api/activities/:id',
      handler: (ctx) =>
        runtime.invoke({ op: 'activity.public_detail', args: { activity_id: Number(ctx.params.id) } }),
    },

    // ---------- 报名端本人（M3：报名 / 签到 / 通知 / 订阅，需 Bearer token） ----------
    {
      method: 'POST',
      pattern: '/api/activities/:id/registration',
      handler: admin('registration.create', { activity_id: 'id' }),
    },
    { method: 'GET', pattern: '/api/me/registrations', handler: admin('registration.mine') },
    { method: 'GET', pattern: '/api/me/registrations/:rid', handler: admin('registration.detail', { registration_id: 'rid' }) },
    { method: 'PUT', pattern: '/api/me/registrations/:rid', handler: admin('registration.save', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/me/registrations/:rid/submit', handler: admin('registration.submit', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/me/registrations/:rid/cancel', handler: admin('registration.cancel', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/me/registrations/:rid/checkin', handler: admin('checkin.mine', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/me/checkin/code', handler: admin('checkin.code') },
    { method: 'GET', pattern: '/api/me/notifications', handler: admin('notification.mine') },
    { method: 'GET', pattern: '/api/me/notifications/unread-count', handler: admin('notification.unread_count') },
    { method: 'PUT', pattern: '/api/me/notifications/:nid/read', handler: admin('notification.read', { notification_id: 'nid' }) },
    { method: 'PUT', pattern: '/api/me/notifications/read-all', handler: admin('notification.read_all') },
    { method: 'POST', pattern: '/api/me/subscribe/:activityId', handler: admin('subscribe.add', { activity_id: 'activityId' }) },
    { method: 'DELETE', pattern: '/api/me/subscribe/:activityId', handler: admin('subscribe.remove', { activity_id: 'activityId' }) },
    { method: 'GET', pattern: '/api/me/subscribes', handler: admin('subscribe.mine') },

    // ---------- 管理端（M3：报名名单 / 审核 / 签到 / 动态码） ----------
    { method: 'GET', pattern: '/api/admin/activities/:id/registrations', handler: admin('registration.admin_list', { activity_id: 'id' }) },
    { method: 'GET', pattern: '/api/admin/registrations/:rid', handler: admin('registration.admin_detail', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/registrations/:rid/review', handler: admin('registration.review', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/registrations/:rid/checkin', handler: admin('checkin.do', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/checkin/receipt', handler: admin('checkin.do') },
    { method: 'GET', pattern: '/api/admin/activities/:id/checkin-code', handler: admin('checkin.code_current', { activity_id: 'id' }) },
  ];
}
