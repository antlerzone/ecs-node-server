-- 0191 follow-up: drop FK on cln_employeedetail.client_id before dropping column (rename kept constraint name).
SET NAMES utf8mb4;

SET @db := DATABASE();
SET @fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_employeedetail'
    AND COLUMN_NAME = 'client_id' AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);

SET @sql := IF(
  @fk IS NOT NULL,
  CONCAT('ALTER TABLE `cln_employeedetail` DROP FOREIGN KEY `', @fk, '`'),
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_employeedetail' AND column_name = 'client_id'
);
SET @sql2 := IF(
  @has_col > 0,
  'ALTER TABLE `cln_employeedetail` DROP COLUMN `client_id`',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
