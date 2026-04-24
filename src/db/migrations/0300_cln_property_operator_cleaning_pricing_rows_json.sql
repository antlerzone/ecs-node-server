-- Multi-row cleaning price: JSON array [{ service, line, myr }]; legacy columns mirror first row.
-- Run: node scripts/run-migration.js src/db/migrations/0300_cln_property_operator_cleaning_pricing_rows_json.sql

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_cleaning_pricing_rows_json'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_cleaning_pricing_rows_json` LONGTEXT NULL COMMENT ''JSON array of {service,line,myr}'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
