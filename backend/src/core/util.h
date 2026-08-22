#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace sacc {

// 当前 Unix 时间（秒），全系统时间约定
std::int64_t now_ts();

// 加密安全随机字节：WASI random_get / 原生 /dev/urandom
void random_bytes(unsigned char* out, std::size_t n);

// 字节数组转 hex 小写字符串
std::string to_hex(const unsigned char* data, std::size_t n);

// 转义 SQL LIKE 通配符（% _ \），配合 ESCAPE '\' 使用（注册列表 / 导出过滤共用）
std::string escape_like(const std::string& s);

} // namespace sacc
