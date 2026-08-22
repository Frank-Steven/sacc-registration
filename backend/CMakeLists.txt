cmake_minimum_required(VERSION 3.24)
project(sacc_backend LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Debug)
endif()

set(SACC_INCLUDE_DIRS
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR}/third_party/sqlite
)

# SQLite 编译选项：单线程（宿主串行化写）、禁扩展加载、内存临时表
set(SACC_SQLITE_DEFS
  SQLITE_THREADSAFE=0
  SQLITE_OMIT_LOAD_EXTENSION
  SQLITE_DEFAULT_MEMSTATUS=0
  SQLITE_MAX_MMAP_SIZE=0
  SQLITE_TEMP_STORE=2
)

# ---------- 核心库（native 测试与 wasm 共用逻辑） ----------
add_library(sacc_core STATIC
  src/core/util.cpp
  src/core/db.cpp
  src/core/dispatch.cpp
  src/crypto/kdf.cpp
  src/user/auth.cpp
  src/config/authz.cpp
  src/config/activity.cpp
  src/config/group.cpp
  src/config/form.cpp
  src/config/template.cpp
  src/config/config.cpp
  src/config/role.cpp
  third_party/sqlite/sqlite3.c
)
target_include_directories(sacc_core PUBLIC ${SACC_INCLUDE_DIRS})
target_compile_definitions(sacc_core PRIVATE ${SACC_SQLITE_DEFS})

# ---------- native 单元测试 ----------
enable_testing()
add_executable(sacc_test test/test_main.cpp)
target_link_libraries(sacc_test PRIVATE sacc_core)
target_compile_definitions(sacc_test PRIVATE
  SACC_MIGRATIONS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../db/migrations"
)
add_test(NAME sacc_core COMMAND sacc_test)

# ---------- wasm 目标（backend.wasm） ----------
set(WASI_SDK_PREFIX "$ENV{WASI_SDK_PREFIX}" CACHE PATH "wasi-sdk 安装前缀（缺省取仓库内 .tools）")
if(NOT WASI_SDK_PREFIX)
  set(WASI_SDK_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/../.tools/wasi-sdk-25.0-arm64-macos")
endif()

add_custom_target(backend_wasm
  COMMAND ${CMAKE_COMMAND}
    -S ${CMAKE_CURRENT_SOURCE_DIR}/wasm
    -B ${CMAKE_CURRENT_BINARY_DIR}/wasm
    -DCMAKE_TOOLCHAIN_FILE=${CMAKE_CURRENT_SOURCE_DIR}/wasm/wasi-toolchain.cmake
    -DSACC_SOURCES_DIR=${CMAKE_CURRENT_SOURCE_DIR}
    -DWASI_SDK_PREFIX=${WASI_SDK_PREFIX}
  COMMAND ${CMAKE_COMMAND} --build ${CMAKE_CURRENT_BINARY_DIR}/wasm
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
    ${CMAKE_CURRENT_BINARY_DIR}/wasm/backend.wasm
    ${CMAKE_CURRENT_BINARY_DIR}/backend.wasm
  COMMENT "构建 backend.wasm（wasm32-wasi）"
  USES_TERMINAL
)
