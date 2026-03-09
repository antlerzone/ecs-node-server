#!/bin/bash
# 从头到尾按顺序执行所有 migration（需已配置 .env 的 DB_HOST, DB_USER, DB_PASSWORD, DB_NAME）
set -e
cd "$(dirname "$0")/.."
echo "Running all migrations from src/db/migrations (sorted)..."
for f in $(ls -1 src/db/migrations/*.sql | sort -V); do
  echo "=== $(basename "$f") ==="
  node scripts/run-migration.js "$f" || exit 1
done
echo "All migrations done."
