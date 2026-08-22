// JWT（无状态会话）：HMAC-SHA256，零外部依赖，密钥来自 config.jwtSecret
import crypto from 'node:crypto';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// 恒定时间字符串比较（防签名时序侧信道）；长度不同直接判不等
const safeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// 签发：payload 仅含 uid / username / iat / exp
export function signJwt(payload, secret, ttlSeconds = 7 * 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64');
  return `${h}.${p}.${b64url(sig)}`;
}

// 校验：返回 payload；签名不符 / 过期 / 格式错误返回 null
export function verifyJwt(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64');
  if (!safeEqual(b64url(expect), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// 从 Authorization: Bearer <token> 中解析 token
export function bearerToken(headers) {
  const auth = headers && (headers.authorization || headers.Authorization);
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
