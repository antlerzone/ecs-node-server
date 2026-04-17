#!/bin/bash
# 修復 1) xendit-create-sub-account 404：用 server.js 啟動 API（含 companysetting）
# 修復 2) Next.js /operator/company client manifest 錯誤：完整重建
set -e
cd "$(dirname "$0")/.."

echo "=== 1) 重啟 API（若 app 已在跑 server.js 用 restart，否則用 server.js 啟動）==="
if pm2 describe app &>/dev/null; then
  pm2 restart app
  echo "API 已重啟 (app)"
else
  pm2 start server.js --name app
  echo "API 已用 server.js 啟動"
fi

echo ""
echo "=== 2) Next.js 完整重建並重啟 portal-next ==="
cd coliving/next-app
rm -rf .next
npm run build
pm2 restart portal-next
echo "完成。請再試 Xendit Create account 與 /operator/company 頁面。"
