-- Cleanlemons: add `operatordetail_id` → FK `cln_operatordetail(id)` on tables that had no operator scope.
-- Requires 0198 (`cln_operatordetail` exists). Skips missing `cln_*` tables (Coliving-only DBs).
-- Backfill UPDATEs use prepared statements so `cln_operatordetail` is never referenced when the table is absent.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SELECT COUNT(*) INTO @has_od FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_operatordetail';

-- ─── cln_attendance ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_attendance';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_attendance' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_attendance` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_attendance` a SET a.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE a.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_attendance' AND INDEX_NAME = 'idx_cln_attendance_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_attendance_operatordetail_id` ON `cln_attendance` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_attendance' AND CONSTRAINT_NAME = 'fk_cln_attendance_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_attendance` ADD CONSTRAINT `fk_cln_attendance_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_feedback ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_feedback';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_feedback' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_feedback` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_feedback` x SET x.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE x.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_feedback' AND INDEX_NAME = 'idx_cln_feedback_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_feedback_operatordetail_id` ON `cln_feedback` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_feedback' AND CONSTRAINT_NAME = 'fk_cln_feedback_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_feedback` ADD CONSTRAINT `fk_cln_feedback_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_linens ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_linens';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_linens' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_linens` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_linens` x SET x.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE x.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_linens' AND INDEX_NAME = 'idx_cln_linens_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_linens_operatordetail_id` ON `cln_linens` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_linens' AND CONSTRAINT_NAME = 'fk_cln_linens_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_linens` ADD CONSTRAINT `fk_cln_linens_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_kpi_deduction ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_kpi_deduction';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_kpi_deduction' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_kpi_deduction` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_kpi_deduction` x SET x.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE x.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_kpi_deduction' AND INDEX_NAME = 'idx_cln_kpi_deduction_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_kpi_deduction_operatordetail_id` ON `cln_kpi_deduction` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_kpi_deduction' AND CONSTRAINT_NAME = 'fk_cln_kpi_deduction_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_kpi_deduction` ADD CONSTRAINT `fk_cln_kpi_deduction_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_operator_notification ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_operator_notification';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_notification' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_operator_notification` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_operator_notification` x SET x.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE x.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_notification' AND INDEX_NAME = 'idx_cln_operator_notification_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_operator_notification_operatordetail_id` ON `cln_operator_notification` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_notification' AND CONSTRAINT_NAME = 'fk_cln_operator_notification_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_operator_notification` ADD CONSTRAINT `fk_cln_operator_notification_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_employee_attendance: operatordetail_id + replace unique key ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_employee_attendance';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employee_attendance' AND COLUMN_NAME = 'operatordetail_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_employee_attendance` ADD COLUMN `operatordetail_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bfj := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_employee_attendance` ea INNER JOIN `cln_employeedetail` ed ON LOWER(TRIM(ed.email)) = LOWER(TRIM(ea.email)) INNER JOIN (SELECT employee_id, MIN(operator_id) AS operator_id FROM `cln_employee_operator` GROUP BY employee_id) j ON j.employee_id = ed.id SET ea.`operatordetail_id` = j.`operator_id` WHERE ea.`operatordetail_id` IS NULL',
  'SELECT 1');
PREPARE bfj FROM @bfj; EXECUTE bfj; DEALLOCATE PREPARE bfj;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_employee_attendance` ea SET ea.`operatordetail_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE ea.`operatordetail_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @uqOld := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employee_attendance' AND INDEX_NAME = 'uq_cln_emp_attendance_email_date'),
  0);
SET @sqlDropUq := IF(@has_od > 0 AND @t > 0 AND @uqOld > 0,
  'ALTER TABLE `cln_employee_attendance` DROP INDEX `uq_cln_emp_attendance_email_date`',
  'SELECT 1');
PREPARE duq FROM @sqlDropUq; EXECUTE duq; DEALLOCATE PREPARE duq;

SET @uqNew := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employee_attendance' AND INDEX_NAME = 'uq_cln_emp_attendance_od_email_date'),
  1);
SET @sqlUq := IF(@has_od > 0 AND @t > 0 AND @uqNew = 0,
  'ALTER TABLE `cln_employee_attendance` ADD UNIQUE KEY `uq_cln_emp_attendance_od_email_date` (`operatordetail_id`, `email`, `date_key`)',
  'SELECT 1');
PREPARE suq FROM @sqlUq; EXECUTE suq; DEALLOCATE PREPARE suq;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employee_attendance' AND INDEX_NAME = 'idx_cln_employee_attendance_operatordetail_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_employee_attendance_operatordetail_id` ON `cln_employee_attendance` (`operatordetail_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_employee_attendance' AND CONSTRAINT_NAME = 'fk_cln_employee_attendance_operatordetail'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_employee_attendance` ADD CONSTRAINT `fk_cln_employee_attendance_operatordetail` FOREIGN KEY (`operatordetail_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ─── cln_operator_agreement_template: operator_id + FK (if missing) ───
SELECT COUNT(*) INTO @t FROM information_schema.tables WHERE table_schema = @db AND table_name = 'cln_operator_agreement_template';
SET @exist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_agreement_template' AND COLUMN_NAME = 'operator_id'),
  1);
SET @sql := IF(@has_od > 0 AND @t > 0 AND @exist = 0,
  'ALTER TABLE `cln_operator_agreement_template` ADD COLUMN `operator_id` CHAR(36) NULL CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT ''FK cln_operatordetail.id'' AFTER `id`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bf := IF(@has_od > 0 AND @t > 0,
  'UPDATE `cln_operator_agreement_template` tpl SET tpl.`operator_id` = (SELECT o.`id` FROM `cln_operatordetail` o ORDER BY o.`id` LIMIT 1) WHERE tpl.`operator_id` IS NULL AND (SELECT COUNT(*) FROM `cln_operatordetail`) = 1',
  'SELECT 1');
PREPARE bf FROM @bf; EXECUTE bf; DEALLOCATE PREPARE bf;

SET @hasidx := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_agreement_template' AND INDEX_NAME = 'idx_cln_operator_agreement_template_operator_id'),
  1);
SET @sql2 := IF(@has_od > 0 AND @t > 0 AND @hasidx = 0,
  'CREATE INDEX `idx_cln_operator_agreement_template_operator_id` ON `cln_operator_agreement_template` (`operator_id`)',
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

SET @fkexist := IF(@t > 0,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_operator_agreement_template' AND CONSTRAINT_NAME = 'fk_cln_operator_agreement_template_operator'),
  1);
SET @sql3 := IF(@has_od > 0 AND @t > 0 AND @fkexist = 0,
  'ALTER TABLE `cln_operator_agreement_template` ADD CONSTRAINT `fk_cln_operator_agreement_template_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;
