-- Per-operator: last calendar day (Asia/Kuala_Lumpur) we ran daily AI schedule for that operator.

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_ai' AND column_name = 'last_schedule_ai_cron_day'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_operator_ai` ADD COLUMN `last_schedule_ai_cron_day` VARCHAR(10) NULL AFTER `chat_summary`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
