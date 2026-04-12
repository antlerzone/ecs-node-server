-- Remove legacy `cln_supervisor`; operator portal supervisors live in cln_employeedetail + cln_employee_operator (staff_role supervisor).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_supervisor'
);

SET @fk := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE table_schema = @db AND table_name = 'cln_supervisor' AND constraint_name = 'fk_cln_supervisor_operator'
);

SET @sql_drop_fk := IF(@has > 0 AND @fk > 0,
  'ALTER TABLE `cln_supervisor` DROP FOREIGN KEY `fk_cln_supervisor_operator`',
  'SELECT 1');
PREPARE s1 FROM @sql_drop_fk;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @sql_drop := IF(@has > 0, 'DROP TABLE `cln_supervisor`', 'SELECT 1');
PREPARE s2 FROM @sql_drop;
EXECUTE s2;
DEALLOCATE PREPARE s2;
