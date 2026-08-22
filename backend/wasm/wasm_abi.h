#ifndef SACC_WASM_ABI_H
#define SACC_WASM_ABI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// 共享线性内存分配 / 释放（宿主侧调用）
void* wasm_alloc(uint32_t size);
void wasm_free(void* ptr);

// 模块版本（NUL 结尾字符串，静态存储）
const char* wasm_version(void);

#ifdef __cplusplus
}
#endif

#endif // SACC_WASM_ABI_H
