-- Add account column to ownerdetail, tenantdetail, supplierdetail if missing (for Contact list/detail).
-- Run from OS shell: mysql -uUSER -p DBNAME < 0049_contact_account_columns.sql
-- Do NOT paste the "mysql -u..." command into MySQL client (that causes syntax error).

-- ownerdetail.account
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ownerdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE ownerdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- tenantdetail.account
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenantdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE tenantdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- supplierdetail.account
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplierdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE supplierdetail ADD COLUMN account text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Option B: If you can only run SQL in a console (e.g. RDS Query Editor), run these one by one.
-- Ignore "Duplicate column name 'account'" if the column already exists.
-- ALTER TABLE ownerdetail ADD COLUMN account text DEFAULT NULL;
-- ALTER TABLE tenantdetail ADD COLUMN account text DEFAULT NULL;
-- ALTER TABLE supplierdetail ADD COLUMN account text DEFAULT NULL;
