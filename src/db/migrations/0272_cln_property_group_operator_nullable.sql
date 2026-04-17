-- Allow property groups without a bound operator until the client links one (B2B portal).
-- Run: node scripts/run-migration.js src/db/migrations/0272_cln_property_group_operator_nullable.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group' AND CONSTRAINT_NAME = 'fk_cln_pg_operator'
);
SET @sqldrop := IF(@fk > 0,
  'ALTER TABLE `cln_property_group` DROP FOREIGN KEY `fk_cln_pg_operator`',
  'SELECT 1'
);
PREPARE s1 FROM @sqldrop; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @n := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group' AND COLUMN_NAME = 'operator_id'
  LIMIT 1
);
SET @sqlmod := IF(IFNULL(@n, '') = 'YES',
  'SELECT 1',
  'ALTER TABLE `cln_property_group` MODIFY COLUMN `operator_id` CHAR(36) NULL COMMENT ''FK cln_operatordetail — optional until linked'''
);
PREPARE s2 FROM @sqlmod; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fk2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group' AND CONSTRAINT_NAME = 'fk_cln_pg_operator'
);
SET @sqladd := IF(@fk2 = 0,
  'ALTER TABLE `cln_property_group` ADD CONSTRAINT `fk_cln_pg_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE s3 FROM @sqladd; EXECUTE s3; DEALLOCATE PREPARE s3;
