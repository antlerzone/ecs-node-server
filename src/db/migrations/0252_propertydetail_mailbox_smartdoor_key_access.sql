-- Coliving propertydetail: mailbox / smartdoor key-collection fields (operator portal).
-- Run: node scripts/run-migration.js src/db/migrations/0252_propertydetail_mailbox_smartdoor_key_access.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'mailbox_password'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `mailbox_password` TEXT NULL COMMENT ''Key collection: mailbox'' AFTER `cleanlemons_cleaning_tenant_price_myr`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'smartdoor_password'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `smartdoor_password` TEXT NULL COMMENT ''Key collection: smart door password note'' AFTER `mailbox_password`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'smartdoor_token_enabled'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `smartdoor_token_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Key collection: smart door token / e-key enabled'' AFTER `smartdoor_password`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
