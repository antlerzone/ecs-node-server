-- Coliving propertydetail: JSON blob for operator portal security-system login fields (icare / ecommunity / veemios / gprop / css).
-- Run: node scripts/run-migration.js src/db/migrations/0265_propertydetail_security_system_credentials_json.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'propertydetail' AND COLUMN_NAME = 'security_system_credentials_json'
    ),
    'SELECT 1',
    'ALTER TABLE `propertydetail` ADD COLUMN `security_system_credentials_json` LONGTEXT NULL COMMENT ''Operator portal: security system credentials JSON'' '
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
