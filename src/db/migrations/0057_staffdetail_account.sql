-- staffdetail.account: same as ownerdetail/tenantdetail, JSON array [{ clientId, provider, id }] for accounting contact id per client.
-- Used when syncing staff (employee) to Bukku/Xero/AutoCount/SQL on approve or manual link.
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffdetail' AND COLUMN_NAME = 'account');
SET @sql = IF(@col = 0, 'ALTER TABLE staffdetail ADD COLUMN account text DEFAULT NULL COMMENT ''JSON: [{ clientId, provider, id }]''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
