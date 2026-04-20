-- Operator portal: hide archived properties from default list; operator-created units only.
-- Run: node scripts/run-migration.js src/db/migrations/0279_cln_property_operator_portal_archived.sql

SET NAMES utf8mb4;
SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'operator_portal_archived'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `operator_portal_archived` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=Archived in operator portal (operator-created rows only)'' AFTER `updated_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
