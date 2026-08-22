#include "crypto/kdf.h"

#include <cstring>

namespace sacc {

namespace {

// SHA-256 常量
constexpr std::uint32_t kK[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2};

constexpr std::uint32_t kH0[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};

inline std::uint32_t rotr(std::uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }

// 单块 SHA-256 压缩
void sha256_block(const unsigned char block[64], std::uint32_t h[8]) {
  std::uint32_t w[64];
  for (int i = 0; i < 16; ++i) {
    w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
           (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
           (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
           static_cast<std::uint32_t>(block[i * 4 + 3]);
  }
  for (int i = 16; i < 64; ++i) {
    const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
  std::uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
  for (int i = 0; i < 64; ++i) {
    const std::uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const std::uint32_t ch = (e & f) ^ (~e & g);
    const std::uint32_t t1 = hh + s1 + ch + kK[i] + w[i];
    const std::uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    const std::uint32_t t2 = s0 + maj;
    hh = g; g = f; f = e; e = d + t1;
    d = c; c = b; b = a; a = t1 + t2;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d;
  h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

} // namespace

void sha256(const unsigned char* data, std::size_t len, unsigned char out[32]) {
  std::uint32_t h[8];
  std::memcpy(h, kH0, sizeof(h));

  std::size_t off = 0;
  for (; len - off >= 64; off += 64) sha256_block(data + off, h);

  const std::uint64_t bit_len = static_cast<std::uint64_t>(len) * 8;
  const std::size_t rem = len - off;
  unsigned char tail[128];
  std::memcpy(tail, data + off, rem);
  tail[rem] = 0x80;
  // 填充至 56 字节（mod 64），最后 8 字节写 64 位大端长度（跨块时长度位于第二块）
  const std::size_t pad = (rem < 56) ? (55 - rem) : (119 - rem);
  std::memset(tail + rem + 1, 0, pad);
  const std::size_t len_pos = (rem < 56) ? 56 : 120;
  for (int i = 0; i < 8; ++i) tail[len_pos + 7 - i] = static_cast<unsigned char>(bit_len >> (i * 8));
  sha256_block(tail, h);
  if (rem >= 56) sha256_block(tail + 64, h);

  for (int i = 0; i < 8; ++i) {
    out[i * 4] = static_cast<unsigned char>(h[i] >> 24);
    out[i * 4 + 1] = static_cast<unsigned char>(h[i] >> 16);
    out[i * 4 + 2] = static_cast<unsigned char>(h[i] >> 8);
    out[i * 4 + 3] = static_cast<unsigned char>(h[i]);
  }
}

void hmac_sha256(const unsigned char* key, std::size_t key_len, const unsigned char* msg,
                 std::size_t msg_len, unsigned char out[32]) {
  unsigned char kpad[64] = {0};
  if (key_len > 64) {
    sha256(key, key_len, kpad);
  } else {
    std::memcpy(kpad, key, key_len);
  }

  // 调用场景（PBKDF2）内层消息 <= 64+32+4 字节，栈缓冲足够
  unsigned char ipad[64], opad[64];
  for (int i = 0; i < 64; ++i) {
    ipad[i] = static_cast<unsigned char>(kpad[i] ^ 0x36);
    opad[i] = static_cast<unsigned char>(kpad[i] ^ 0x5c);
  }
  unsigned char inner_data[64 + 32 + 4];
  std::memcpy(inner_data, ipad, 64);
  std::memcpy(inner_data + 64, msg, msg_len);
  unsigned char inner[32];
  sha256(inner_data, 64 + msg_len, inner);

  unsigned char outer[64 + 32];
  std::memcpy(outer, opad, 64);
  std::memcpy(outer + 64, inner, 32);
  sha256(outer, 64 + 32, out);
}

void pbkdf2_sha256(const unsigned char* password, std::size_t password_len,
                   const unsigned char* salt, std::size_t salt_len, std::uint32_t iterations,
                   unsigned char out[32]) {
  // 输出固定 32 字节 → 仅需 1 个 PBKDF2 块
  unsigned char msg[32 + 4];
  std::memcpy(msg, salt, salt_len);
  msg[salt_len] = 0;
  msg[salt_len + 1] = 0;
  msg[salt_len + 2] = 0;
  msg[salt_len + 3] = 1; // 块索引 1（大端）

  unsigned char u[32];
  hmac_sha256(password, password_len, msg, salt_len + 4, u);
  std::memcpy(out, u, 32);
  for (std::uint32_t i = 1; i < iterations; ++i) {
    hmac_sha256(password, password_len, u, 32, u);
    for (int j = 0; j < 32; ++j) out[j] ^= u[j];
  }
}

} // namespace sacc
