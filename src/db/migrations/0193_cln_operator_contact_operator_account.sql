-- Cleanlemons operator contacts: scope per operator + accounting account[] (same pattern as supplierdetail.account).
SET NAMES utf8mb4;

SET @db := DATABASE();

SET @has_op := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_contact' AND column_name = 'operator_id'
);
SET @sql := IF(
  @has_op = 0,
  'ALTER TABLE cln_operator_contact ADD COLUMN operator_id CHAR(36) NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ac := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_contact' AND column_name = 'account'
);
SET @sql2 := IF(
  @has_ac = 0,
  'ALTER TABLE cln_operator_contact ADD COLUMN account LONGTEXT NULL COMMENT ''JSON: [{clientId,provider,id}]'' AFTER permissions_json',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @op_cnt := (SELECT COUNT(*) FROM cln_operator);
UPDATE cln_operator_contact
SET operator_id = (SELECT id FROM cln_operator LIMIT 1)
WHERE operator_id IS NULL AND @op_cnt = 1;
