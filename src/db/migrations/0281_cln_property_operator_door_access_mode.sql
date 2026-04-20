-- Cleanlemons B2B: how operator may open door for a property (TTLock remote vs static password).
-- Run: node scripts/run-migration.js src/db/migrations/0281_cln_property_operator_door_access_mode.sql

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_door_access_mode'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_door_access_mode` VARCHAR(32) NOT NULL DEFAULT ''fixed_password'' COMMENT ''full_access | working_date_only | fixed_password'' AFTER `smartdoor_token_enabled`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
