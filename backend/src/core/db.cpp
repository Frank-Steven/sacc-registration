#include "core/db.h"

#include <cstdio>
#include <sqlite3.h>

namespace sacc {

namespace {
// 将 JSON 参数数组（1 基索引）绑定到语句。
int bindParams(sqlite3_stmt* stmt, const nlohmann::json& params) {
  if (params.is_null()) return SQLITE_OK;
  if (!params.is_array()) return SQLITE_MISUSE;
  for (size_t i = 0; i < params.size(); ++i) {
    const int idx = static_cast<int>(i + 1);
    const auto& v = params[i];
    int rc = SQLITE_OK;
    if (v.is_null()) {
      rc = sqlite3_bind_null(stmt, idx);
    } else if (v.is_boolean()) {
      rc = sqlite3_bind_int(stmt, idx, v.get<bool>() ? 1 : 0);
    } else if (v.is_number_integer()) {
      rc = sqlite3_bind_int64(stmt, idx, v.get<long long>());
    } else if (v.is_number_float()) {
      rc = sqlite3_bind_double(stmt, idx, v.get<double>());
    } else if (v.is_string()) {
      rc = sqlite3_bind_text(stmt, idx, v.get<std::string>().c_str(), -1, SQLITE_TRANSIENT);
    } else {
      return SQLITE_MISUSE;
    }
    if (rc != SQLITE_OK) return rc;
  }
  return SQLITE_OK;
}
} // namespace

Db::~Db() { close(); }

int Db::open(const std::string& path) {
  if (db_) return SQLITE_OK;
  int rc = sqlite3_open_v2(path.c_str(), &db_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nullptr);
  if (rc != SQLITE_OK) {
    errmsg_ = db_ ? sqlite3_errmsg(db_) : "cannot allocate database handle";
    close();
    return rc;
  }
  exec("PRAGMA journal_mode=WAL;");
  exec("PRAGMA foreign_keys=ON;");
  return SQLITE_OK;
}

void Db::close() {
  if (db_) {
    sqlite3_close(db_);
    db_ = nullptr;
  }
}

int Db::userVersion() const {
  if (!db_) return -1;
  sqlite3_stmt* stmt = nullptr;
  int version = -1;
  if (sqlite3_prepare_v2(db_, "PRAGMA user_version;", -1, &stmt, nullptr) == SQLITE_OK) {
    if (sqlite3_step(stmt) == SQLITE_ROW) version = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
  }
  return version;
}

int Db::setUserVersion(int version) {
  if (!db_) return SQLITE_MISUSE;
  char sql[64];
  std::snprintf(sql, sizeof(sql), "PRAGMA user_version=%d;", version);
  return exec(sql);
}

int Db::migrate(const std::string& sql, int version) {
  if (!db_) return SQLITE_MISUSE;
  int rc = exec("BEGIN IMMEDIATE;");
  if (rc != SQLITE_OK) return rc;
  rc = exec(sql);
  if (rc != SQLITE_OK) {
    exec("ROLLBACK;");
    return rc;
  }
  rc = setUserVersion(version);
  if (rc != SQLITE_OK) {
    exec("ROLLBACK;");
    return rc;
  }
  rc = exec("COMMIT;");
  return rc;
}

int Db::exec(const std::string& sql) {
  if (!db_) return SQLITE_MISUSE;
  char* err = nullptr;
  const int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &err);
  if (rc != SQLITE_OK) {
    errmsg_ = err ? err : sqlite3_errmsg(db_);
    if (err) sqlite3_free(err);
  }
  return rc;
}

int Db::query(const std::string& sql, const nlohmann::json& params, nlohmann::json& out_rows,
              std::string& out_err) {
  out_rows = nlohmann::json::array();
  if (!db_) {
    out_err = "db not open";
    return SQLITE_MISUSE;
  }
  sqlite3_stmt* stmt = nullptr;
  int rc = sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr);
  if (rc != SQLITE_OK) {
    out_err = sqlite3_errmsg(db_);
    return rc;
  }
  rc = bindParams(stmt, params);
  if (rc != SQLITE_OK) {
    out_err = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return rc;
  }
  while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
    nlohmann::json row = nlohmann::json::object();
    const int ncol = sqlite3_column_count(stmt);
    for (int c = 0; c < ncol; ++c) {
      const char* name = sqlite3_column_name(stmt, c);
      switch (sqlite3_column_type(stmt, c)) {
        case SQLITE_INTEGER:
          row[name] = sqlite3_column_int64(stmt, c);
          break;
        case SQLITE_FLOAT:
          row[name] = sqlite3_column_double(stmt, c);
          break;
        case SQLITE_TEXT:
          row[name] = reinterpret_cast<const char*>(sqlite3_column_text(stmt, c));
          break;
        default:
          row[name] = nullptr;
          break;
      }
    }
    out_rows.push_back(std::move(row));
  }
  if (rc != SQLITE_DONE) {
    out_err = sqlite3_errmsg(db_);
    sqlite3_finalize(stmt);
    return rc;
  }
  sqlite3_finalize(stmt);
  return SQLITE_OK;
}

int Db::lastChanges() const { return db_ ? sqlite3_changes(db_) : 0; }

std::string Db::lastError() const {
  if (!errmsg_.empty()) return errmsg_;
  return db_ ? sqlite3_errmsg(db_) : "db not open";
}

} // namespace sacc
