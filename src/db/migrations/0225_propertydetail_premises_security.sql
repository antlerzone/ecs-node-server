-- Coliving propertydetail: premises_type + security_system (source for pd→cln sync).
-- Run: node scripts/run-migration.js src/db/migrations/0225_propertydetail_premises_security.sql

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'premises_type'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `premises_type` VARCHAR(32) NULL COMMENT ''landed|apartment|other|office|commercial'' AFTER `apartmentname`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'security_system'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `security_system` VARCHAR(32) NULL COMMENT ''e.g. icare|ecommunity'' AFTER `premises_type`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
