-- Cleanlemons: cache platform SaaS Bukku customer id on company master (separate from operator-linked bukku_contact_id).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_od FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operatordetail';

SELECT COUNT(*) INTO @col_od FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operatordetail' AND COLUMN_NAME = 'bukku_saas_contact_id';

SET @sql_od := IF(@has_od > 0 AND @col_od = 0,
  'ALTER TABLE `cln_operatordetail` ADD COLUMN `bukku_saas_contact_id` INT NULL COMMENT ''Platform SaaS Bukku customer (Cleanlemons billing)'' AFTER `bukku_contact_id`',
  'SELECT 1');
PREPARE stmt_od FROM @sql_od;
EXECUTE stmt_od;
DEALLOCATE PREPARE stmt_od;

-- Legacy name before 0198 (skip if already renamed)
SELECT COUNT(*) INTO @has_op FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operator';

SELECT COUNT(*) INTO @col_op FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator' AND COLUMN_NAME = 'bukku_saas_contact_id';

SET @sql_op := IF(@has_op > 0 AND @col_op = 0,
  'ALTER TABLE `cln_operator` ADD COLUMN `bukku_saas_contact_id` INT NULL COMMENT ''Platform SaaS Bukku customer (Cleanlemons billing)'' AFTER `bukku_contact_id`',
  'SELECT 1');
PREPARE stmt_op FROM @sql_op;
EXECUTE stmt_op;
DEALLOCATE PREPARE stmt_op;
