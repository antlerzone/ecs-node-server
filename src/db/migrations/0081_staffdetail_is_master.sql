-- staffdetail.is_master: 1 = default admin created at 開戶 (manual billing), cannot be deleted in UI.
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'staffdetail' AND COLUMN_NAME = 'is_master');
SET @sql = IF(@col = 0, 'ALTER TABLE staffdetail ADD COLUMN is_master tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=company-email master admin, do not delete'' AFTER status', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
