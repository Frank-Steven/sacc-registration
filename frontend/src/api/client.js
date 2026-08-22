import axios from 'axios';
import { Errors } from './errors.js';

// axios 服务层：统一解包 { code, data, message }，code=0 返回 data，否则抛业务错误
const client = axios.create({ baseURL: '/api', timeout: 15000 });

client.interceptors.response.use(
  (res) => {
    const body = res.data;
    if (body && body.code === Errors.OK) return body.data;
    const err = new Error(body?.message || '请求失败');
    err.code = body?.code;
    throw err;
  },
  (err) => {
    const wrapped = new Error(err.response?.data?.message || err.message);
    wrapped.code = err.response?.data?.code ?? Errors.INTERNAL;
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
export function del(url) {
  return client.delete(url);
}

export default client;
