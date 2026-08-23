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
  ${SACC_SOURCES_DIR}/src/user/profile.cpp
  ${SACC_SOURCES_DIR}/src/config/authz.cpp
  ${SACC_SOURCES_DIR}/src/config/activity.cpp
  ${SACC_SOURCES_DIR}/src/config/group.cpp
  ${SACC_SOURCES_DIR}/src/config/form.cpp
  ${SACC_SOURCES_DIR}/src/config/template.cpp
  ${SACC_SOURCES_DIR}/src/config/config.cpp
  ${SACC_SOURCES_DIR}/src/config/role.cpp
  ${SACC_SOURCES_DIR}/src/config/account.cpp
  ${SACC_SOURCES_DIR}/src/data/registration.cpp
  ${SACC_SOURCES_DIR}/src/data/validation.cpp
  ${SACC_SOURCES_DIR}/src/data/review.cpp
  ${SACC_SOURCES_DIR}/src/data/checkin.cpp
  ${SACC_SOURCES_DIR}/src/data/notification.cpp
  ${SACC_SOURCES_DIR}/src/data/subscribe.cpp
  ${SACC_SOURCES_DIR}/src/data/export.cpp
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
# 栈显式扩到 1MB：默认 wasm-ld 栈仅 64KB，字段校验正则递归（validation.cpp 深度上限 4000）
# 需要更大栈空间，防止合法长文本触发 wasm trap
target_link_options(backend_wasm PRIVATE
  -mexec-model=reactor
  -Wl,-z,stack-size=1048576
  -Wl,--initial-memory=2097152
  -Wl,--export=wasm_alloc,--export=wasm_free,--export=wasm_version,--export=wasm_invoke
)
