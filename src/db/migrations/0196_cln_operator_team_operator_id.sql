-- Scope Cleanlemons operator teams to cln_operator (multi-tenant).
-- Collation must match `cln_operator.id` (utf8mb4_unicode_ci per 0176) or InnoDB rejects the FK.

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @exist := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_team' AND COLUMN_NAME = 'operator_id'
);
SET @sql := IF(
  @exist = 0,
  'ALTER TABLE `cln_operator_team` ADD COLUMN `operator_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operator.id'' AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Align type/collation if column was added in a failed partial run (e.g. default server collation).
SET @exist2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_team' AND COLUMN_NAME = 'operator_id'
);
SET @sqlFix := IF(
  @exist2 > 0,
  'ALTER TABLE `cln_operator_team` MODIFY COLUMN `operator_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operator.id''',
  'SELECT 1'
);
PREPARE stmtFix FROM @sqlFix;
EXECUTE stmtFix;
DEALLOCATE PREPARE stmtFix;

-- Single-tenant backfill: attach all existing teams to the only operator row.
UPDATE `cln_operator_team` t
SET t.`operator_id` = (SELECT o.`id` FROM `cln_operator` o ORDER BY o.`id` LIMIT 1)
WHERE t.`operator_id` IS NULL
  AND (SELECT COUNT(*) FROM `cln_operator`) = 1;

SET @hasidx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_team' AND INDEX_NAME = 'idx_cln_operator_team_operator_id'
);
SET @sql2 := IF(
  @hasidx = 0,
  'CREATE INDEX `idx_cln_operator_team_operator_id` ON `cln_operator_team` (`operator_id`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @fkexist := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db
    AND TABLE_NAME = 'cln_operator_team'
    AND CONSTRAINT_NAME = 'fk_cln_operator_team_operator'
);
SET @sql3 := IF(
  @fkexist = 0,
  'ALTER TABLE `cln_operator_team` ADD CONSTRAINT `fk_cln_operator_team_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operator` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
