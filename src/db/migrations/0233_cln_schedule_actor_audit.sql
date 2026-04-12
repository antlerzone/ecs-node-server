-- Operator schedule audit: who created the job and who first set status to ready-to-clean.
-- Run: node scripts/run-migration.js src/db/migrations/0233_cln_schedule_actor_audit.sql

SET @db = DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'created_by_email'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `created_by_email` VARCHAR(255) NULL COMMENT ''Portal email when job was created'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'ready_to_clean_by_email'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `ready_to_clean_by_email` VARCHAR(255) NULL COMMENT ''Email when status first became ready-to-clean'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'ready_to_clean_at'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_schedule` ADD COLUMN `ready_to_clean_at` DATETIME(3) NULL COMMENT ''When status first became ready-to-clean'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
