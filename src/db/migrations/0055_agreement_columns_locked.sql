-- Agreement: lock all columns except final url/hash_final/status after completion.
-- When columns_locked = 1, only url, pdfurl, hash_final, status (and updated_at) may be updated.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'columns_locked');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN columns_locked tinyint(1) NOT NULL DEFAULT 0 COMMENT ''1=freeze all except url/pdfurl/hash_final/status'' AFTER version', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
