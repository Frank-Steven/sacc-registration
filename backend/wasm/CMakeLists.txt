cmake_minimum_required(VERSION 3.24)
project(sacc_backend_wasm LANGUAGES C CXX)

# 由宿主 CMakeLists 通过 -DSACC_SOURCES_DIR 传入源码根目录
set(SACC_SOURCES_DIR "" CACHE PATH "sacc-backend 源码根目录")

add_executable(backend_wasm
  ${SACC_SOURCES_DIR}/wasm/wasm_abi.c
  ${SACC_SOURCES_DIR}/wasm/wasm_entry.cpp
  ${SACC_SOURCES_DIR}/src/core/util.cpp
  ${SACC_SOURCES_DIR}/src/core/db.cpp
  ${SACC_SOURCES_DIR}/src/core/dispatch.cpp
  ${SACC_SOURCES_DIR}/src/crypto/kdf.cpp
  ${SACC_SOURCES_DIR}/src/user/auth.cpp
  ${SACC_SOURCES_DIR}/third_party/sqlite/sqlite3.c
)

target_include_directories(backend_wasm PRIVATE
  ${SACC_SOURCES_DIR}/src
  ${SACC_SOURCES_DIR}/third_party
  ${SACC_SOURCES_DIR}/third_party/sqlite
)

target_compile_definitions(backend_wasm PRIVATE
  SQLITE_THREADSAFE=0
  SQLITE_OMIT_LOAD_EXTENSION
  SQLITE_DEFAULT_MEMSTATUS=0
  SQLITE_MAX_MMAP_SIZE=0
  SQLITE_TEMP_STORE=2
)

set_target_properties(backend_wasm PROPERTIES OUTPUT_NAME backend SUFFIX ".wasm")

# reactor 模式（无 _start，仅导出 ABI 函数）
target_link_options(backend_wasm PRIVATE
  -mexec-model=reactor
  -Wl,--export=wasm_alloc,--export=wasm_free,--export=wasm_version,--export=wasm_invoke
)
