-- Cleanlemons: driver trip completion time + employeedetail vehicle fields for portal.
-- Run: node scripts/run-migration.js src/db/migrations/0287_cln_driver_trip_extras.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

-- cln_driver_trip.completed_at_utc
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_driver_trip' AND COLUMN_NAME = 'completed_at_utc'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE `cln_driver_trip` ADD COLUMN `completed_at_utc` DATETIME(3) NULL AFTER `grab_booked_at_utc`',
  'SELECT 1'
);
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;

-- cln_employeedetail driver vehicle (nullable), one column per ALTER for partial runs
SET @col2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employeedetail' AND COLUMN_NAME = 'driver_car_plate'
);
SET @sql2 := IF(@col2 = 0, 'ALTER TABLE `cln_employeedetail` ADD COLUMN `driver_car_plate` VARCHAR(32) NULL', 'SELECT 1');
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SET @col3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employeedetail' AND COLUMN_NAME = 'driver_car_front_url'
);
SET @sql3 := IF(@col3 = 0, 'ALTER TABLE `cln_employeedetail` ADD COLUMN `driver_car_front_url` TEXT NULL', 'SELECT 1');
PREPARE s3 FROM @sql3;
EXECUTE s3;
DEALLOCATE PREPARE s3;

SET @col4 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employeedetail' AND COLUMN_NAME = 'driver_car_back_url'
);
SET @sql4 := IF(@col4 = 0, 'ALTER TABLE `cln_employeedetail` ADD COLUMN `driver_car_back_url` TEXT NULL', 'SELECT 1');
PREPARE s4 FROM @sql4;
EXECUTE s4;
DEALLOCATE PREPARE s4;
