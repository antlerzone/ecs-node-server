-- Ensure `account` text column exists on contact tables (accounting contact id JSON per client).
-- Idempotent. Fixes: Unknown column 'account' in 'field list' on contact sync (from-accounting).
-- Run: node scripts/run-migration.js src/db/migrations/0145_contactdetail_account_column_if_missing.sql

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ownerdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE ownerdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenantdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE tenantdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplierdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE supplierdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE staffdetail ADD COLUMN account text DEFAULT NULL COMMENT ''JSON: [{ clientId, provider, id }]''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
