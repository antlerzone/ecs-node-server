-- Cleanlemons: company master row — rename `cln_operator` → `cln_operatordetail`
-- (parity with Coliving `operatordetail`). Child FKs continue to reference the same `id` column.
-- Idempotent: skips if `cln_operatordetail` already exists or `cln_operator` is missing.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_op FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operator';
SELECT COUNT(*) INTO @has_od FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operatordetail';

SET @sql := IF(
  @has_op > 0 AND @has_od = 0,
  'RENAME TABLE `cln_operator` TO `cln_operatordetail`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
