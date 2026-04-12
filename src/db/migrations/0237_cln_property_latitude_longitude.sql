-- Cleanlemons: optional WGS84 coordinates on cln_property (map pin / schedule; supplements URL parsing).
-- Run: node scripts/run-migration.js src/db/migrations/0237_cln_property_latitude_longitude.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'latitude'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `latitude` DECIMAL(10,7) NULL COMMENT ''WGS84 latitude'' AFTER `google_maps_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'longitude'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `longitude` DECIMAL(10,7) NULL COMMENT ''WGS84 longitude'' AFTER `latitude`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
