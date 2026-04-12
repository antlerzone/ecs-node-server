-- Cleanlemons: public marketing URL segment portal.cleanlemons.com/{public_subdomain}
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_od FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operatordetail';

SELECT COUNT(*) INTO @col_od FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operatordetail' AND COLUMN_NAME = 'public_subdomain';

SET @sql_od := IF(@has_od > 0 AND @col_od = 0,
  'ALTER TABLE `cln_operatordetail` ADD COLUMN `public_subdomain` VARCHAR(64) NULL COMMENT ''Public pricing page path segment (unique, lowercase)'' AFTER `email`',
  'SELECT 1');
PREPARE stmt_od FROM @sql_od;
EXECUTE stmt_od;
DEALLOCATE PREPARE stmt_od;

SELECT COUNT(*) INTO @col_od2 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operatordetail' AND COLUMN_NAME = 'public_subdomain';

SELECT COUNT(*) INTO @uq_od FROM information_schema.statistics
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operatordetail' AND INDEX_NAME = 'uq_cln_operatordetail_public_subdomain';

SET @sql_uq_od := IF(@has_od > 0 AND @col_od2 > 0 AND @uq_od = 0,
  'ALTER TABLE `cln_operatordetail` ADD UNIQUE KEY `uq_cln_operatordetail_public_subdomain` (`public_subdomain`)',
  'SELECT 1');
PREPARE stmt_uq_od FROM @sql_uq_od;
EXECUTE stmt_uq_od;
DEALLOCATE PREPARE stmt_uq_od;

-- Legacy table name before 0198 (skip if absent)
SELECT COUNT(*) INTO @has_op FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operator';

SELECT COUNT(*) INTO @col_op FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator' AND COLUMN_NAME = 'public_subdomain';

SET @sql_op := IF(@has_op > 0 AND @col_op = 0,
  'ALTER TABLE `cln_operator` ADD COLUMN `public_subdomain` VARCHAR(64) NULL COMMENT ''Public pricing page path segment (unique, lowercase)'' AFTER `email`',
  'SELECT 1');
PREPARE stmt_op FROM @sql_op;
EXECUTE stmt_op;
DEALLOCATE PREPARE stmt_op;

SELECT COUNT(*) INTO @col_op2 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator' AND COLUMN_NAME = 'public_subdomain';

SELECT COUNT(*) INTO @uq_op FROM information_schema.statistics
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator' AND INDEX_NAME = 'uq_cln_operator_public_subdomain';

SET @sql_uq_op := IF(@has_op > 0 AND @col_op2 > 0 AND @uq_op = 0,
  'ALTER TABLE `cln_operator` ADD UNIQUE KEY `uq_cln_operator_public_subdomain` (`public_subdomain`)',
  'SELECT 1');
PREPARE stmt_uq_op FROM @sql_uq_op;
EXECUTE stmt_uq_op;
DEALLOCATE PREPARE stmt_uq_op;
