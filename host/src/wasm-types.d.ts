// wasm 边界共享类型（checkJs 模式下供 host/src 下 JSDoc 引用）。
// 协议约定见 docs/backend/wasm.md：入参出参均为 JSON，经共享线性内存传递。

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface InvokeRequest {
  op: string;
  args?: Record<string, JsonValue>;
}

// 响应：code 0 表示成功；失败时为 message（业务错误码登记见 host/src/errors.js）
export interface InvokeResult {
  code: number;
  data?: any;
  message?: string;
}
