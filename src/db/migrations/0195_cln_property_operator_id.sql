-- Scope Cleanlemons properties to portal operator (invoice / property list per tenant).

SET NAMES utf8mb4;

SET @db = DATABASE();
SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_id'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `operator_id` VARCHAR(64) NULL COMMENT ''Cleanlemons portal operator id'' AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hasidx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_operator_id'
);
SET @sql2 := IF(
  @hasidx = 0,
  'CREATE INDEX `idx_cln_property_operator_id` ON `cln_property` (`operator_id`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
