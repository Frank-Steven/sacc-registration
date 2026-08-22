#pragma once

#include <nlohmann/json.hpp>
#include <string>

struct sqlite3;

namespace sacc {

// SQLite 封装：WAL + 外键约束，供 wasm 与 native 测试共用。
class Db {
public:
  Db() = default;
  ~Db();
  Db(const Db&) = delete;
  Db& operator=(const Db&) = delete;

  bool isOpen() const { return db_ != nullptr; }

  // 打开数据库（不存在则创建）
  int open(const std::string& path);
  void close();

  // 当前 schema 版本（PRAGMA user_version）
  int userVersion() const;

  // 迁移：BEGIN → sql → user_version=version → COMMIT（失败回滚）
  int migrate(const std::string& sql, int version);

  // 写入 schema 版本（仅供迁移使用）
  int setUserVersion(int version);

  // 写 SQL，返回 SQLITE_OK / 错误码
  int exec(const std::string& sql);

  // 查询：绑定参数（JSON 数组，1 基）后取行
  int query(const std::string& sql, const nlohmann::json& params, nlohmann::json& out_rows,
            std::string& out_err);

  // 最近一次写语句影响的行数
  int lastChanges() const;

  // 最近错误信息
  std::string lastError() const;

private:
  sqlite3* db_ = nullptr;
  std::string errmsg_;
};

} // namespace sacc
