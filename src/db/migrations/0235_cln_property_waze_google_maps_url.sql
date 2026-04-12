-- Cleanlemons: optional navigation links on cln_property (operator property form).
-- Run: node scripts/run-migration.js src/db/migrations/0235_cln_property_waze_google_maps_url.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'waze_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `waze_url` TEXT NULL COMMENT ''Waze deep link'' AFTER `address`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'google_maps_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `google_maps_url` TEXT NULL COMMENT ''Google Maps share URL'' AFTER `waze_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
