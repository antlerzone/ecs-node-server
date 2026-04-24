-- Operator portal: per-property cleaning line (from pricing by-property rows) + operator-set MYR price.
-- Run: node scripts/run-migration.js src/db/migrations/0297_cln_property_operator_cleaning_pricing.sql

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_cleaning_pricing_line'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_cleaning_pricing_line` VARCHAR(128) NULL COMMENT ''By-property label from operator pricing (e.g. Studio)'' AFTER `team`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_cleaning_price_myr'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_cleaning_price_myr` DECIMAL(14,2) NULL COMMENT ''Operator-set cleaning price (MYR)'' AFTER `operator_cleaning_pricing_line`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
