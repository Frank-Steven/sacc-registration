#include <cstring>
#include <string>

#include <nlohmann/json.hpp>

#include "core/db.h"
#include "core/dispatch.h"
#include "wasm_abi.h"

namespace {

sacc::Db g_db;

// 将响应 JSON 写入共享内存并返回指针（宿主读取后调用 wasm_free 释放）。
const char* respond(const nlohmann::json& res) {
  const std::string out = res.dump();
  char* buf = static_cast<char*>(wasm_alloc(static_cast<uint32_t>(out.size() + 1)));
  std::memcpy(buf, out.c_str(), out.size() + 1);
  return buf;
}

} // namespace

extern "C" const char* wasm_invoke(const char* req) {
  // 无异常模式：allow_exceptions=false，解析失败返回 discarded，由 dispatch 转为错误响应
  nlohmann::json req_json = req ? nlohmann::json::parse(req, nullptr, false) : nlohmann::json();
  return respond(sacc::dispatch(g_db, req_json));
}
