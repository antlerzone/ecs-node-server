#!/bin/bash
# Deploy Next.js portal (build + restart PM2).
# Run from repo root: /home/ecs-user/app
#
# Note: .env is gitignored. BUKKU_SAAS_API_KEY / BUKKU_SAAS_SUBDOMAIN etc. must be
# set once on the server (nano .env); deploy does not overwrite .env.
#
# Usage:
#   ./scripts/deploy-portal.sh          # build portal + restart portal-next
#   ./scripts/deploy-portal.sh --pull   # git pull, then build + restart
#   ./scripts/deploy-portal.sh --all    # also restart Node API (app) after portal

set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORTAL_DIR="$ROOT/coliving/next-app"

if [ "$1" = "--pull" ] || [ "$1" = "-p" ]; then
  echo "[deploy] git pull..."
  git pull
  shift
fi

echo "[deploy] Installing portal deps..."
cd "$PORTAL_DIR"
npm install

echo "[deploy] Cleaning previous Next build artifacts..."
rm -rf .next

echo "[deploy] Building portal (Next.js, low-memory safe mode)..."
npm run build:low

echo "[deploy] Restarting portal-next..."
pm2 restart portal-next

if [ "$1" = "--all" ] || [ "$1" = "-a" ]; then
  echo "[deploy] Restarting app (Node API)..."
  pm2 restart app
fi

echo "[deploy] Done. portal-next is running."
pm2 list
