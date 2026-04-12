#!/bin/bash
# Deploy Cleanlemons Next portal (next-cleanlemons on PM2). Run from repo root.
#
# Usage:
#   ./scripts/deploy-cleanlemons-portal.sh
#   ./scripts/deploy-cleanlemons-portal.sh --pull
#   ./scripts/deploy-cleanlemons-portal.sh --all    # also: pm2 restart $CLEANLEMON_API_PM2_NAME (default: api-cleanlemons)

set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORTAL_DIR="$ROOT/cleanlemon/next-app"

if [ "$1" = "--pull" ] || [ "$1" = "-p" ]; then
  echo "[deploy-cleanlemons] git pull..."
  git pull
  shift
fi

echo "[deploy-cleanlemons] Installing portal deps..."
cd "$PORTAL_DIR"
npm install

echo "[deploy-cleanlemons] Cleaning previous Next build (.next)..."
rm -rf .next

echo "[deploy-cleanlemons] Building (webpack, low-memory safe)..."
export RESTART_PM2_AFTER_NEXT_BUILD=1
npm run build:low

# next start 只在启动时登记 .next/static 下的文件；build 后不重启会 404（磁盘有文件也 404）。
echo "[deploy-cleanlemons] Restarting Next.js (all PM2 apps matching this portal)..."
pm2 restart next-cleanlemons
if pm2 describe next-cleanlemons-3000 &>/dev/null; then
  echo "[deploy-cleanlemons] Also restarting next-cleanlemons-3000 (same cwd; avoids stale chunk mismatch)."
  pm2 restart next-cleanlemons-3000
fi

if [ "$1" = "--all" ] || [ "$1" = "-a" ]; then
  API_NAME="${CLEANLEMON_API_PM2_NAME:-api-cleanlemons}"
  echo "[deploy-cleanlemons] Restarting API pm2 process: $API_NAME"
  pm2 restart "$API_NAME" || echo "[deploy-cleanlemons] pm2 restart $API_NAME failed; set CLEANLEMON_API_PM2_NAME and retry."
fi

echo "[deploy-cleanlemons] Done."
pm2 list
