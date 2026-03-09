-- Remove unused columns from account. accountid/productid are stored per-client in account_json and account_client, not at row level.
-- Safe for older MySQL: check column exists before drop.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND COLUMN_NAME = 'accountid');
SET @sql = IF(@col > 0, 'ALTER TABLE account DROP COLUMN accountid', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND COLUMN_NAME = 'productid');
SET @sql = IF(@col > 0, 'ALTER TABLE account DROP COLUMN productid', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
