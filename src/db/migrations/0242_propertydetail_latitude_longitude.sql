-- Coliving `propertydetail`: WGS84 coordinates (aligned with `cln_property.latitude` / `longitude`).
-- Run: node scripts/run-migration.js src/db/migrations/0242_propertydetail_latitude_longitude.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'propertydetail' AND column_name = 'latitude'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `propertydetail` ADD COLUMN `latitude` DECIMAL(10,7) NULL COMMENT ''WGS84 latitude'' AFTER `address`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'propertydetail' AND column_name = 'longitude'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `propertydetail` ADD COLUMN `longitude` DECIMAL(10,7) NULL COMMENT ''WGS84 longitude'' AFTER `latitude`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
