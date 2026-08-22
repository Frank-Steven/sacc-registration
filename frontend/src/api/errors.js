// 统一错误码登记 —— 与 host/src/errors.js 及后端 wasm 保持同步
export const Errors = Object.freeze({
  OK: 0,
  INTERNAL: 1,

  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,

  UNKNOWN_OP: 1001,
  INVALID_REQUEST: 1002,
  DB_ERROR: 2001,
});

export const ErrorMessage = Object.freeze({
  [Errors.OK]: '成功',
  [Errors.INTERNAL]: '服务内部错误',
  [Errors.UNAUTHORIZED]: '未登录或会话已过期',
  [Errors.FORBIDDEN]: '没有权限',
  [Errors.NOT_FOUND]: '资源不存在',
  [Errors.CONFLICT]: '名额已满或状态冲突',
  [Errors.VALIDATION]: '参数校验失败',
  [Errors.UNKNOWN_OP]: '不支持的操作',
  [Errors.DB_ERROR]: '数据错误',
});
