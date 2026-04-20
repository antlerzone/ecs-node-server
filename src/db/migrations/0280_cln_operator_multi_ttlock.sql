-- Multiple TTLock Open Platform logins per Cleanlemons operator (cln_operatordetail).
-- Mirrors 0276 client pattern: cln_operator_integration (key=smartDoor, provider=ttlock, slot) + cln_ttlocktoken (operator_id, slot).

SET NAMES utf8mb4;
SET @db = DATABASE();

-- cln_operator_integration: unique (operator_id, key, provider, slot)
SET @has_oi := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_integration'
);
SET @has_old_uq_oi := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_integration' AND INDEX_NAME = 'uniq_cln_operator_integration'
);
SET @sql_oi := IF(
  @has_oi > 0 AND @has_old_uq_oi > 0,
  'ALTER TABLE cln_operator_integration DROP INDEX uniq_cln_operator_integration',
  'SELECT 1'
);
PREPARE s_oi FROM @sql_oi;
EXECUTE s_oi;
DEALLOCATE PREPARE s_oi;

SET @has_new_uq_oi := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_integration' AND INDEX_NAME = 'uniq_cln_operator_integration_slot'
);
SET @sql_oi2 := IF(
  @has_oi > 0 AND @has_new_uq_oi = 0,
  'ALTER TABLE cln_operator_integration ADD UNIQUE KEY uniq_cln_operator_integration_slot (operator_id, `key`, provider, slot)',
  'SELECT 1'
);
PREPARE s_oi2 FROM @sql_oi2;
EXECUTE s_oi2;
DEALLOCATE PREPARE s_oi2;

-- cln_ttlocktoken: one OAuth row per (operator_id, slot); replaces single uq on operator_id alone
SET @has_tt := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
);
SET @has_slot_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND COLUMN_NAME = 'slot'
);
SET @sql_slot := IF(
  @has_tt > 0 AND @has_slot_col = 0,
  'ALTER TABLE cln_ttlocktoken ADD COLUMN slot INT NOT NULL DEFAULT 0 AFTER operator_id',
  'SELECT 1'
);
PREPARE s_slot FROM @sql_slot;
EXECUTE s_slot;
DEALLOCATE PREPARE s_slot;

SET @has_uq_op := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_operator'
);
SET @sql_drop_uq_op := IF(
  @has_tt > 0 AND @has_uq_op > 0,
  'ALTER TABLE cln_ttlocktoken DROP INDEX uq_cln_ttlocktoken_operator',
  'SELECT 1'
);
PREPARE s_drop FROM @sql_drop_uq_op;
EXECUTE s_drop;
DEALLOCATE PREPARE s_drop;

SET @has_uq_op_slot := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_operator_slot'
);
SET @sql_add_uq_op_slot := IF(
  @has_tt > 0 AND @has_uq_op_slot = 0,
  'ALTER TABLE cln_ttlocktoken ADD UNIQUE KEY uq_cln_ttlocktoken_operator_slot (operator_id, slot)',
  'SELECT 1'
);
PREPARE s_add_uq FROM @sql_add_uq_op_slot;
EXECUTE s_add_uq;
DEALLOCATE PREPARE s_add_uq;
