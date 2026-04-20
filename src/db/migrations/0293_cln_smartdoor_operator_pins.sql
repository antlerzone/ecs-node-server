-- Cleanlemons: TTLock keyboard passcode tracking + temporary_password_only mode.
-- Run: node scripts/run-migration.js src/db/migrations/0293_cln_smartdoor_operator_pins.sql

SET @db = DATABASE();

-- Ensure operator_door_access_mode exists (same as 0281; safe if 0281 already ran)
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

-- Map legacy modes to two-mode product: full_access stays; others -> temporary_password_only
UPDATE `cln_property`
SET `operator_door_access_mode` = 'temporary_password_only'
WHERE `operator_door_access_mode` IN ('working_date_only', 'fixed_password');

-- cln_property: operator permanent passcode TTLock id + display label
SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_smartdoor_keyboard_pwd_id'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_smartdoor_keyboard_pwd_id` VARCHAR(64) NULL COMMENT ''TTLock keyboardPwdId for operator permanent PIN'' AFTER `operator_door_access_mode`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_smartdoor_passcode_name'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_smartdoor_passcode_name` VARCHAR(255) NULL COMMENT ''TTLock keyboardPwdName snapshot'' AFTER `operator_smartdoor_keyboard_pwd_id`'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- cln_schedule: per-job temporary PIN (TTLock + plain for staff)
SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'job_smartdoor_pin'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `job_smartdoor_pin` VARCHAR(32) NULL COMMENT ''Plain PIN for operator (temporary mode job)'''
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'job_smartdoor_keyboard_pwd_id'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `job_smartdoor_keyboard_pwd_id` VARCHAR(64) NULL COMMENT ''TTLock keyboardPwdId for job PIN'''
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
