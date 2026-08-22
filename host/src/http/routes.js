// API 路由：method + path 正则 → handler(ctx) → { code, data?, message? }
// ctx = { query, body, headers }（headers 由 server.js 注入）
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
  ];
}
