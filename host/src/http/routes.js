// API 路由：method + path → handler(ctx) → { code, data?, message? }
// - pattern 支持 RegExp（M1）与字符串路径（含 :param，M2 起，命中注入 ctx.params）
// - ctx = { query, body, headers, params }（server.js 注入）
// - 管理端统一 /api/admin/*：宿主校验 JWT 后透传 uid 入 wasm，权限判定在 wasm 内
import fs from 'node:fs';
import path from 'node:path';
import { Errors } from '../errors.js';
import { signJwt, verifyJwt, bearerToken } from '../auth/jwt.js';
import { createBackup } from '../task/backup.js';

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

  // 管理端 handler 工厂：JWT 鉴权 → args 组装 → 透传 wasm
  const admin = (op, pathMap = {}) => async (ctx) => {
    const auth = requireAuth(ctx, config);
    if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
    // 审查 Issue 10：仅 GET 透传 query 作过滤参数；写方法只用 body + 路径参数，避免 query 覆盖 body
    const args = ctx.method === 'GET'
      ? { ...Object.fromEntries(ctx.query || []), uid: auth.uid }
      : { ...ctx.body, uid: auth.uid };
    for (const [argKey, paramName] of Object.entries(pathMap)) {
      const v = ctx.params?.[paramName];
      if (v === undefined) continue;
      const num = Number(v);
      if (!Number.isInteger(num) || num <= 0) {
        return { code: Errors.VALIDATION, message: `路径参数 ${paramName} 必须为正整数` };
      }
      args[argKey] = num;
    }
    return runtime.invoke({ op, args });
  };

  // 备份文件命名（与 task/backup.js BACKUP_RE 一致）；文件名仅来自数据库生成，杜绝路径穿越
  const BACKUP_RE = /^sacc-\d{8}-\d{6}(?:-\d+)?\.db$/;
  const backupDir = () => path.join(path.dirname(config.dbPath), 'backup');
  // 宿主能力路由（备份管理）的超管校验：透查 wasm user_role.list 判定 role_id=1
  const requireSuperAdmin = async (ctx) => {
    const auth = requireAuth(ctx, config);
    if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
    const out = await runtime.invoke({ op: 'user_role.list', args: { uid: auth.uid, target_uid: auth.uid } });
    if (out.code !== Errors.OK || !(out.data?.items || []).some((r) => r.role_id === 1)) {
      return { code: Errors.FORBIDDEN, message: '仅超级管理员可管理备份' };
    }
    return auth;
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
        // 审查 Issue 11：不暴露表名清单，仅保留版本与 schema 版本
        return {
          code: 0,
          data: {
            wasm: runtime.version,
            user_version: uv.code === Errors.OK ? uv.data?.user_version : undefined,
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
    { method: 'GET', pattern: '/api/admin/activities/stats', handler: admin('activity.stats') }, // M4 跨活动统计：须在 :id 之前注册
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
    // M6：将活动当前表单快照保存为模板（wasm op 已存在，M2 无独立 HTTP 路由，M6 补充）
    { method: 'POST', pattern: '/api/admin/activities/:id/templates', handler: admin('form_template.save_from_activity', { activity_id: 'id' }) },
    // 角色 / 授权 / 审计（user_role.list 按目标用户查询，route 语义见 config.md 2.2）
    { method: 'GET', pattern: '/api/admin/roles', handler: admin('role.list') },
    { method: 'GET', pattern: '/api/admin/users/:uid/roles', handler: admin('user_role.list', { target_uid: 'uid' }) },
    { method: 'POST', pattern: '/api/admin/roles/:roleId/users', handler: admin('user_role.grant', { role_id: 'roleId' }) },
    { method: 'DELETE', pattern: '/api/admin/user-roles/:uid/:roleId', handler: admin('user_role.revoke', { target_uid: 'uid', role_id: 'roleId' }) },
    { method: 'GET', pattern: '/api/admin/audit-logs', handler: admin('audit_log.list') },

    // ---------- 管理端（M7 系统管理 B1~B4：账号 / 数据统计） ----------
    { method: 'GET', pattern: '/api/admin/users', handler: admin('user.admin_list') },
    { method: 'POST', pattern: '/api/admin/users/:uid/status', handler: admin('account.set_status', { target_uid: 'uid' }) },
    { method: 'POST', pattern: '/api/admin/users/:uid/reset-password', handler: admin('account.admin_reset', { target_uid: 'uid' }) },
    { method: 'GET', pattern: '/api/admin/db/stats', handler: admin('db.stats') },

    // ---------- 管理端（M7 B5：备份管理，宿主能力 + 超管校验） ----------
    {
      method: 'GET',
      pattern: '/api/admin/backups',
      handler: async (ctx) => {
        const auth = await requireSuperAdmin(ctx);
        if (!auth.uid) return auth;
        let names = [];
        try {
          names = fs.readdirSync(backupDir()).filter((f) => BACKUP_RE.test(f)).sort();
        } catch {
          /* 备份目录尚未创建 */
        }
        const items = names
          .map((name) => {
            const st = fs.statSync(path.join(backupDir(), name));
            return { name, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) };
          })
          .reverse(); // 最新在前
        return { code: 0, data: { items } };
      },
    },
    {
      method: 'POST',
      pattern: '/api/admin/backups',
      handler: async (ctx) => {
        const auth = await requireSuperAdmin(ctx);
        if (!auth.uid) return auth;
        try {
          const dest = await createBackup({ runtime, wasmPath: config.wasmPath, dbPath: config.dbPath, verify: true });
          return { code: 0, data: { file: path.basename(dest) } };
        } catch (err) {
          return { code: Errors.INTERNAL, message: `备份失败：${err.message}` };
        }
      },
    },
    {
      method: 'GET',
      pattern: '/api/admin/backups/:file',
      handler: async (ctx) => {
        const auth = await requireSuperAdmin(ctx);
        if (!auth.uid) return auth;
        const name = ctx.params.file;
        if (!BACKUP_RE.test(name)) return { code: Errors.VALIDATION, message: '备份文件名非法' };
        const abs = path.join(backupDir(), name);
        if (!fs.existsSync(abs)) return { code: Errors.NOT_FOUND, message: '备份文件不存在' };
        return {
          code: 0,
          data: {},
          download: { filename: name, contentType: 'application/octet-stream', content: fs.readFileSync(abs) },
        };
      },
    },

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
    // 报名端公开分组树（M5 B3：活动大厅左侧筛选）
    {
      method: 'GET',
      pattern: '/api/groups/tree',
      handler: () => runtime.invoke({ op: 'group.public_tree' }),
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

    // ---------- 报名端本人资料（M5 B4~B6：基础资料 / 常用信息 / 通知偏好） ----------
    { method: 'PUT', pattern: '/api/me/profile', handler: admin('user.update') },
    { method: 'GET', pattern: '/api/me/common-info', handler: admin('user_common_info.list') },
    { method: 'PUT', pattern: '/api/me/common-info', handler: admin('user_common_info.save') },
    {
      method: 'DELETE',
      pattern: '/api/me/common-info',
      handler: async (ctx) => {
        const auth = requireAuth(ctx, config);
        if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
        const key = ctx.query.get('key');
        if (!key) return { code: Errors.VALIDATION, message: '缺少 key 参数' };
        return runtime.invoke({ op: 'user_common_info.delete', args: { uid: auth.uid, field_key: key } });
      },
    },
    { method: 'GET', pattern: '/api/me/notify-prefs', handler: admin('user_notify_pref.list') },
    { method: 'PUT', pattern: '/api/me/notify-prefs', handler: admin('user_notify_pref.set') },
    {
      method: 'DELETE',
      pattern: '/api/me/notify-prefs',
      handler: async (ctx) => {
        const auth = requireAuth(ctx, config);
        if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
        const t = Number(ctx.query.get('type'));
        if (!Number.isInteger(t) || t < 0 || t > 3) {
          return { code: Errors.VALIDATION, message: 'type 须为 0~3' };
        }
        return runtime.invoke({ op: 'user_notify_pref.delete', args: { uid: auth.uid, notify_type: t } });
      },
    },
    // 界面偏好（theme/locale 服务端持久化，登录后跨设备同步）
    { method: 'GET', pattern: '/api/me/prefs', handler: admin('user_pref.list') },
    { method: 'PUT', pattern: '/api/me/prefs', handler: admin('user_pref.set') },

    // ---------- 管理端（M3：报名名单 / 审核 / 签到 / 动态码） ----------
    { method: 'GET', pattern: '/api/admin/activities/:id/registrations', handler: admin('registration.admin_list', { activity_id: 'id' }) },
    { method: 'GET', pattern: '/api/admin/registrations/:rid', handler: admin('registration.admin_detail', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/registrations/:rid/review', handler: admin('registration.review', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/registrations/:rid/checkin', handler: admin('checkin.do', { registration_id: 'rid' }) },
    { method: 'POST', pattern: '/api/admin/checkin/receipt', handler: admin('checkin.do') },
    { method: 'GET', pattern: '/api/admin/activities/:id/checkin-code', handler: admin('checkin.code_current', { activity_id: 'id' }) },

    // ---------- 管理端（M4：导出 / 统计，export.md 四） ----------
    { method: 'GET', pattern: '/api/admin/activities/:id/export', handler: admin('registration.export', { activity_id: 'id' }) },
    {
      method: 'GET',
      pattern: '/api/admin/activities/:id/export.csv',
      handler: async (ctx) => {
        const auth = requireAuth(ctx, config);
        if (!auth) return { code: Errors.UNAUTHORIZED, message: '未登录或会话已过期' };
        const args = { ...Object.fromEntries(ctx.query || []), uid: auth.uid, activity_id: Number(ctx.params.id) };
        const out = await runtime.invoke({ op: 'registration.export_csv', args });
        if (out.code !== Errors.OK) return out;
        // TextDecoder 默认剥离 UTF-8 BOM（Excel 兼容），下载时补回
        const csv = out.data.csv.startsWith('\uFEFF') ? out.data.csv : `\uFEFF${out.data.csv}`;
        // 标记下载响应：server.js 据此写 raw CSV（Content-Disposition）而非 JSON
        return {
          code: 0,
          data: out.data,
          download: {
            filename: `registrations_${ctx.params.id}.csv`,
            contentType: 'text/csv; charset=utf-8',
            content: csv,
          },
        };
      },
    },
    { method: 'GET', pattern: '/api/admin/activities/:id/stats', handler: admin('registration.stats', { activity_id: 'id' }) },
    { method: 'GET', pattern: '/api/admin/activities/:id/trend', handler: admin('registration.trend', { activity_id: 'id' }) },
  ];
}
