#!/usr/bin/env bash
# 统一测试工作流：native ctest → backend.wasm → 宿主集成测试 → 前端构建
# 本地与 CI 共用同一入口（yarn test），保证两侧行为一致。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> [1/4] Backend native build + ctest"
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Debug
cmake --build backend/build
ctest --test-dir backend/build --output-on-failure

echo "==> [2/4] Backend wasm build"
cmake --build backend/build --target backend_wasm

echo "==> [3/4] Host integration tests"
node --test host/test/smoke.test.mjs

echo "==> [4/4] Frontend build (前端单测待 M7，构建作为冒烟检查)"
yarn workspace sacc-frontend build

echo "==> 全部测试通过"
