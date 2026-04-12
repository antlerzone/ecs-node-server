-- account: flag rows whose primary mapping in account_client is product_id (Bukku product) for invoicing.
-- Run: node scripts/run-migration.js src/db/migrations/0159_account_is_product.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND COLUMN_NAME = 'is_product'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE account ADD COLUMN is_product tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1 = requires product_id in account_client for this template'' AFTER bukkuaccounttype',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Product-centric / platform+product lines + Tenant Commission (account + product both required)
UPDATE account SET is_product = 1 WHERE id IN (
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3', -- Rental Income
  'e1b2c3d4-2004-4000-8000-000000000304', -- Parking Fees
  'a1b2c3d4-1001-4000-8000-000000000101', -- Topup Aircond
  '2020b22b-028e-4216-906c-c816dcb33a85', -- Forfeit Deposit
  'e1b2c3d4-2002-4000-8000-000000000302'  -- Tenant Commission
);
