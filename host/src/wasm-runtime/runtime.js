import path from 'node:path';
import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';

// backend.wasm 运行时封装（ABI 见 docs/backend/wasm.md）
// - 入参出参均为 JSON 字符串，经共享线性内存传递
// - 单实例下 wasm 导出函数为同步执行，写调用天然串行化
export class WasmRuntime {
  #exports;
  #memory;
  #preopenRoot;

  static async load(wasmPath, preopenRoot) {
    const bytes = await readFile(wasmPath);
    const wasi = new WASI({
      version: 'preview1',
      preopens: preopenRoot ? { '.': preopenRoot } : {},
    });
    const { instance } = await WebAssembly.instantiate(bytes, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    wasi.initialize(instance);
    return new WasmRuntime(instance.exports, preopenRoot);
  }

  constructor(exports, preopenRoot) {
    this.#exports = exports;
    this.#memory = exports.memory;
    this.#preopenRoot = preopenRoot;
  }

  // 将宿主绝对路径转为 wasm 预打开目录（'.'）下的相对路径
  relPath(absPath) {
    const rel = path.relative(this.#preopenRoot, absPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`path outside wasm preopen root: ${absPath}`);
    }
    return './' + rel;
  }

  get version() {
    return this.#readCString(this.#exports.wasm_version());
  }

  // 调用 wasm_invoke，返回解析后的响应 JSON { code, data?, message? }
  /**
   * @param {import('../wasm-types.js').InvokeRequest} req
   * @returns {import('../wasm-types.js').InvokeResult}
   */
  invoke(req) {
    const { memory, wasm_alloc, wasm_free, wasm_invoke } = this.#exports;
    const payload = new TextEncoder().encode(JSON.stringify(req) + '\0');
    const reqPtr = wasm_alloc(payload.length);
    new Uint8Array(memory.buffer, reqPtr, payload.length).set(payload);
    try {
      const resPtr = wasm_invoke(reqPtr);
      this.#memory = memory; // 调用可能触发 memory.grow，重新取引用
      if (resPtr === 0) throw new Error('wasm_invoke returned null');
      const out = this.#readCString(resPtr);
      wasm_free(resPtr);
      return JSON.parse(out);
    } finally {
      wasm_free(reqPtr);
    }
  }

  #readCString(ptr) {
    const view = new Uint8Array(this.#memory.buffer);
    let end = ptr;
    while (view[end] !== 0) end += 1;
    return new TextDecoder().decode(view.subarray(ptr, end));
  }
}
