#!/usr/bin/env bash
# 启用仓库级 git hooks：core.hooksPath 指向版本控制的 .githooks/
# 克隆新环境后执行一次（或 yarn hooks:install）；幂等
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git config core.hooksPath .githooks
echo "git hooks installed (core.hooksPath = .githooks)"
