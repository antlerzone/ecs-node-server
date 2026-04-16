-- Aliyun passport eKYC (GLB03002): store document expiry as DATE (Asia/Kuala_Lumpur calendar date from OCR).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'passport_expiry_date'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `passport_expiry_date` DATE NULL COMMENT 'Passport/doc expiry from Aliyun GLB03002 OCR (calendar date)' AFTER `nric`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
