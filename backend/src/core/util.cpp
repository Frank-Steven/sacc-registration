#include "core/util.h"

#include <cstdio>
#include <cstring>
#include <ctime>

#ifdef __wasi__
#include <wasi/api.h>
#endif

namespace sacc {

std::int64_t now_ts() { return static_cast<std::int64_t>(::time(nullptr)); }

void random_bytes(unsigned char* out, std::size_t n) {
  if (!out || n == 0) return;
#ifdef __wasi__
  // wasi-sdk：random_get 返回 errno，调用失败时退化为确定性填充（仅影响盐/令牌强度）
  if (__wasi_random_get(out, n) != 0) {
    for (std::size_t i = 0; i < n; ++i) out[i] = static_cast<unsigned char>(i * 31);
  }
#else
  FILE* f = std::fopen("/dev/urandom", "rb");
  if (f) {
    const std::size_t got = std::fread(out, 1, n, f);
    std::fclose(f);
    if (got == n) return;
  }
  // 兜底：确定性填充
  for (std::size_t i = 0; i < n; ++i) out[i] = static_cast<unsigned char>(i * 31);
#endif
}

std::string to_hex(const unsigned char* data, std::size_t n) {
  static const char* kHex = "0123456789abcdef";
  std::string out;
  out.reserve(n * 2);
  for (std::size_t i = 0; i < n; ++i) {
    out.push_back(kHex[data[i] >> 4]);
    out.push_back(kHex[data[i] & 0x0f]);
  }
  return out;
}

} // namespace sacc
