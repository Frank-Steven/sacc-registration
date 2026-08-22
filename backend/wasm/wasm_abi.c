#include "wasm_abi.h"

#include <stdlib.h>

void* wasm_alloc(uint32_t size) { return malloc(size == 0 ? 1 : size); }

void wasm_free(void* ptr) { free(ptr); }

const char* wasm_version(void) { return "0.1.0"; }
