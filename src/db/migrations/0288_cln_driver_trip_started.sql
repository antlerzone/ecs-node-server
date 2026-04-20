-- Driver marks "started" after pickup (enables Finish; before that driver can release acceptance).
-- Run: node scripts/run-migration.js src/db/migrations/0288_cln_driver_trip_started.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_driver_trip' AND COLUMN_NAME = 'driver_started_at_utc'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `cln_driver_trip` ADD COLUMN `driver_started_at_utc` DATETIME(3) NULL AFTER `accepted_at_utc`',
  'SELECT 1'
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
