-- Last automatic schedule-AI failure (for operator dashboard / approval notice).

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_ai' AND column_name = 'schedule_ai_last_error_at'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_operator_ai` ADD COLUMN `schedule_ai_last_error_at` DATETIME(3) NULL COMMENT ''UTC'' AFTER `last_schedule_ai_cron_day`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists2 = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_ai' AND column_name = 'schedule_ai_last_error_message'
);
SET @sql2 = IF(@col_exists2 = 0,
  'ALTER TABLE `cln_operator_ai` ADD COLUMN `schedule_ai_last_error_message` VARCHAR(1024) NULL AFTER `schedule_ai_last_error_at`',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @col_exists3 = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_ai' AND column_name = 'schedule_ai_last_error_source'
);
SET @sql3 = IF(@col_exists3 = 0,
  'ALTER TABLE `cln_operator_ai` ADD COLUMN `schedule_ai_last_error_source` VARCHAR(64) NULL COMMENT ''e.g. midnight_batch'' AFTER `schedule_ai_last_error_message`',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
