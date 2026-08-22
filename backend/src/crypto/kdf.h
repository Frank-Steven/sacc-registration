#pragma once

#include <cstddef>
#include <cstdint>

namespace sacc {

// 密码派生：PBKDF2-HMAC-SHA256 迭代次数（可随版本升级，哈希存储不含版本前缀）
inline constexpr std::uint32_t kPbkdf2Iterations = 100000;

// SHA-256（FIPS 180-4）
void sha256(const unsigned char* data, std::size_t len, unsigned char out[32]);

// HMAC-SHA256（RFC 2104），key 最长 64 字节（超出部分先经 SHA-256 压缩）
void hmac_sha256(const unsigned char* key, std::size_t key_len, const unsigned char* msg,
                 std::size_t msg_len, unsigned char out[32]);

// PBKDF2-HMAC-SHA256（RFC 2898），输出固定 32 字节
void pbkdf2_sha256(const unsigned char* password, std::size_t password_len,
                   const unsigned char* salt, std::size_t salt_len, std::uint32_t iterations,
                   unsigned char out[32]);

} // namespace sacc
