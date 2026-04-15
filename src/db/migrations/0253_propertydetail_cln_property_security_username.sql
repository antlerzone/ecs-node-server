-- Coliving/Cleanlemons property access: add security_username for iCare/ecommunity/gprop usernames.
-- Run: node scripts/run-migration.js src/db/migrations/0253_propertydetail_cln_property_security_username.sql

SET NAMES utf8mb4;
SET @db = DATABASE();

-- Coliving source field.
SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'security_username'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `security_username` VARCHAR(191) NULL COMMENT ''Security platform username (icare|ecommunity|gprop)'' AFTER `security_system`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Cleanlemons mirror field.
SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'security_username'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `security_username` VARCHAR(191) NULL COMMENT ''Security platform username (icare|ecommunity|gprop)'' AFTER `security_system`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
