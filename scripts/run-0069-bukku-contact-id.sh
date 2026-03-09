#!/usr/bin/env bash
# 執行 migration 0069：clientdetail.bukku_saas_contact_id
# 用法：./scripts/run-0069-bukku-contact-id.sh  或  node scripts/run-migration.js src/db/migrations/0069_clientdetail_bukku_saas_contact_id.sql

cd "$(dirname "$0")/.."
node scripts/run-migration.js src/db/migrations/0069_clientdetail_bukku_saas_contact_id.sql
