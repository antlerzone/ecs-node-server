-- Agreement e-sign: hash_draft (version at signature), hash_final (after both signed), version.
-- Status lifecycle: draft → ready_for_signature → locked (after first sign) → completed (final PDF).
-- Only rows with status IN ('ready_for_signature','locked','completed') and url IS NOT NULL show in repeater for signing.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'hash_draft');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN hash_draft varchar(64) DEFAULT NULL AFTER url', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'hash_final');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN hash_final varchar(64) DEFAULT NULL AFTER hash_draft', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'version');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN version int NOT NULL DEFAULT 1 AFTER hash_final', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
