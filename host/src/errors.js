// 统一错误码登记 —— 与 backend（C++ dispatch）及 frontend/src/api/errors.js 保持同步
export const Errors = Object.freeze({
  OK: 0,
  INTERNAL: 1, // 未分类内部错误

  UNAUTHORIZED: 401, // 未登录 / token 失效
  FORBIDDEN: 403, // 无权限
  NOT_FOUND: 404,
  CONFLICT: 409, // 名额满 / 重复报名等
  VALIDATION: 422, // 参数校验失败

  // wasm 模块侧错误
  UNKNOWN_OP: 1001,
  INVALID_REQUEST: 1002,
  DB_ERROR: 2001,
});

// wasm code → HTTP 状态
export function httpStatusFor(code) {
  switch (code) {
    case Errors.OK:
      return 200;
    case Errors.UNAUTHORIZED:
      return 401;
    case Errors.FORBIDDEN:
      return 403;
    case Errors.NOT_FOUND:
      return 404;
    case Errors.CONFLICT:
      return 409;
    case Errors.VALIDATION:
      return 422;
    case Errors.INVALID_REQUEST:
    case Errors.UNKNOWN_OP:
      return 400;
    default:
      return 500;
  }
}
