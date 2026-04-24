#!/usr/bin/env bash
# Fixed-path git pull for Telegram ops (no user-controlled args).
set -euo pipefail
ROOT="${APP_ROOT:-/home/ecs-user/app}"
cd "$ROOT"
git fetch origin
git pull origin main
