-- Idempotent: add extend agreement columns if missing (fixes insertAgreement / agreement-insert 500 when 0074 was not applied).
-- See also 0074_agreement_extend_dates_remark.sql

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'extend_begin_date');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN extend_begin_date date DEFAULT NULL COMMENT ''Extend agreement period start (datepickeragreement1)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'extend_end_date');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN extend_end_date date DEFAULT NULL COMMENT ''Extend agreement period end (datepickeragreement2)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'remark');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN remark text DEFAULT NULL COMMENT ''Extend agreement remark''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
