import axios from 'axios';
import { Errors } from './errors.js';

// 401 时清除会话并跳转登录（带 redirect 回跳）。独立函数避免与 store 循环依赖。
function redirectToLogin() {
  try {
    localStorage.removeItem('sacc.auth');
  } catch {
    /* ignore */
  }
  const cur = window.location.pathname + window.location.search;
  const login = `/login?redirect=${encodeURIComponent(cur)}`;
  if (window.location.pathname !== '/login') window.location.assign(login);
}

// axios 服务层：token 注入 + 统一解包 { code, data, message }
// - code===0 → 返回 data（业务成功）
// - 401 → 清除会话并跳登录
// - 其他业务码 → 抛 Error（code / message 附带），由页面与 Query 消费
const client = axios.create({ baseURL: '/api', timeout: 15000 });

client.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem('sacc.auth');
    if (raw) {
      // zustand persist 存储格式为 { state: { token, user }, version }
      const token = JSON.parse(raw)?.state?.token;
      if (token) config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    /* localStorage 不可用时跳过注入 */
  }
  return config;
});

client.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && body.code === Errors.OK) return body.data;
    if (body?.code === Errors.UNAUTHORIZED) redirectToLogin();
    const err = new Error(body?.message || '请求失败');
    err.code = body?.code;
    throw err;
  },
  (err) => {
    if (err.response?.status === 401) redirectToLogin();
    const body = err.response?.data;
    const wrapped = new Error(body?.message || err.message || '网络异常，请稍后重试');
    wrapped.code = body?.code ?? Errors.INTERNAL;
    wrapped.status = err.response?.status;
    throw wrapped;
  }
);

export function get(url, params) {
  return client.get(url, { params });
}
export function post(url, data) {
  return client.post(url, data);
}
export function put(url, data) {
  return client.put(url, data);
}
export function del(url, params) {
  return client.delete(url, { params });
}

export default client;
