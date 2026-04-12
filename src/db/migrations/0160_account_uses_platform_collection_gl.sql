-- 1 = invoice line GL uses Platform Collection mapping, not account_client.accountid on this row (with product_id on this row).
-- Matches accountLineMappingRules INCOME_LINE_PRODUCT_ONLY_TEMPLATE_IDS (Parking, Rental Income, Topup Aircond).
-- Run: node scripts/run-migration.js src/db/migrations/0160_account_uses_platform_collection_gl.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND COLUMN_NAME = 'uses_platform_collection_gl'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE account ADD COLUMN uses_platform_collection_gl tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1 = line GL from Platform Collection else use this row accountid'' AFTER is_product',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE account SET uses_platform_collection_gl = 1 WHERE id IN (
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3', -- Rental Income
  'e1b2c3d4-2004-4000-8000-000000000304', -- Parking Fees
  'a1b2c3d4-1001-4000-8000-000000000101'  -- Topup Aircond
);
