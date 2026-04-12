-- Cleanlemons: persist operator-selected pricing add-ons on schedule rows (Create Job).
-- Separate from submit_by so employee group-start/end JSON does not overwrite add-ons.
-- Run: node scripts/run-migration.js src/db/migrations/0229_cln_schedule_pricing_addons_json.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_schedule' AND column_name = 'pricing_addons_json'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_schedule` ADD COLUMN `pricing_addons_json` LONGTEXT NULL COMMENT ''Operator Create Job: selected pricing add-ons JSON array'' AFTER `submit_by`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
