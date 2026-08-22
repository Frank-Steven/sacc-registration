#!/usr/bin/env bash
# 本地一键开发：确保 wasm 构建 → 启动宿主服务 → 启动前端（Vite 开发代理）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. 确保 backend.wasm 已构建
if [ ! -f backend/build/backend.wasm ]; then
  echo "==> 首次运行：构建 backend.wasm"
  cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Debug >/dev/null
  cmake --build backend/build --target backend_wasm
fi

# 2. 宿主服务（后台）
echo "==> 启动宿主服务 http://localhost:3000"
node host/src/index.js &
HOST_PID=$!
trap 'kill "$HOST_PID" 2>/dev/null || true' EXIT

# 3. 等待宿主就绪
for _ in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# 4. 前端（依赖经根目录 yarn workspaces 统一安装）
if [ ! -d node_modules ]; then
  echo "==> 首次运行：安装依赖（yarn workspaces）"
  yarn install
fi
echo "==> 启动前端 http://localhost:5173"
cd frontend && yarn dev
