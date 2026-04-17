-- Multiple TTLock accounts per Cleanlemons B2B client (cln_clientdetail).
-- Slot 0 = legacy single account / Coliving sync default.

SET NAMES utf8mb4;
SET @db = DATABASE();

-- cln_client_integration: unique (clientdetail_id, key, provider, slot)
-- Idempotent: old index may already be dropped (partial re-runs).
SET @has_ci := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_integration'
);
SET @has_old_uq_ci := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_integration' AND INDEX_NAME = 'uniq_cln_client_integration'
);
SET @sql_ci := IF(
  @has_ci > 0 AND @has_old_uq_ci > 0,
  'ALTER TABLE cln_client_integration DROP INDEX uniq_cln_client_integration',
  'SELECT 1'
);
PREPARE s FROM @sql_ci;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @has_new_uq_ci := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_integration' AND INDEX_NAME = 'uniq_cln_client_integration_slot'
);
SET @sql_ci2 := IF(
  @has_ci > 0 AND @has_new_uq_ci = 0,
  'ALTER TABLE cln_client_integration ADD UNIQUE KEY uniq_cln_client_integration_slot (clientdetail_id, `key`, provider, slot)',
  'SELECT 1'
);
PREPARE s2 FROM @sql_ci2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- cln_ttlocktoken: one OAuth row per (clientdetail, slot); slot 0 = default
SET @has_tt := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
);
SET @col_slot := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND COLUMN_NAME = 'slot'
);

SET @sql_add_slot := IF(
  @has_tt > 0 AND @col_slot = 0,
  'ALTER TABLE cln_ttlocktoken ADD COLUMN slot INT NOT NULL DEFAULT 0 AFTER clientdetail_id',
  'SELECT 1'
);
PREPARE s3 FROM @sql_add_slot;
EXECUTE s3;
DEALLOCATE PREPARE s3;

-- FK `fk_cln_ttlocktoken_clientdetail` uses the unique on `clientdetail_id`; drop FK before dropping that index.
SET @has_fk_tt := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
    AND CONSTRAINT_NAME = 'fk_cln_ttlocktoken_clientdetail' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_drop_fk_tt := IF(
  @has_tt > 0 AND @has_fk_tt > 0,
  'ALTER TABLE cln_ttlocktoken DROP FOREIGN KEY fk_cln_ttlocktoken_clientdetail',
  'SELECT 1'
);
PREPARE s3b FROM @sql_drop_fk_tt;
EXECUTE s3b;
DEALLOCATE PREPARE s3b;

SET @has_uq_cd := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_clientdetail'
);
SET @sql_drop_uq := IF(
  @has_tt > 0 AND @has_uq_cd > 0,
  'ALTER TABLE cln_ttlocktoken DROP INDEX uq_cln_ttlocktoken_clientdetail',
  'SELECT 1'
);
PREPARE s4 FROM @sql_drop_uq;
EXECUTE s4;
DEALLOCATE PREPARE s4;

SET @has_uq_cs := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_cdetail_slot'
);
SET @sql_add_uq := IF(
  @has_tt > 0 AND @has_uq_cs = 0,
  'ALTER TABLE cln_ttlocktoken ADD UNIQUE KEY uq_cln_ttlocktoken_cdetail_slot (clientdetail_id, slot)',
  'SELECT 1'
);
PREPARE s5 FROM @sql_add_uq;
EXECUTE s5;
DEALLOCATE PREPARE s5;

SET @has_fk_tt2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
    AND CONSTRAINT_NAME = 'fk_cln_ttlocktoken_clientdetail' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_add_fk_tt := IF(
  @has_tt > 0 AND @has_fk_tt2 = 0,
  'ALTER TABLE cln_ttlocktoken ADD CONSTRAINT fk_cln_ttlocktoken_clientdetail FOREIGN KEY (clientdetail_id) REFERENCES cln_clientdetail (id) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE s5b FROM @sql_add_fk_tt;
EXECUTE s5b;
DEALLOCATE PREPARE s5b;

-- Tag lock/gateway rows imported per TTLock login (default 0)
SET @has_ld := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail'
);
SET @has_ld_slot := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail' AND COLUMN_NAME = 'cln_ttlock_slot'
);
SET @sql_ld := IF(
  @has_ld > 0 AND @has_ld_slot = 0,
  'ALTER TABLE lockdetail ADD COLUMN cln_ttlock_slot INT NOT NULL DEFAULT 0 COMMENT ''Cleanlemons client: which TTLock account slot'' AFTER cln_clientid',
  'SELECT 1'
);
PREPARE s6 FROM @sql_ld;
EXECUTE s6;
DEALLOCATE PREPARE s6;

SET @has_gd := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail'
);
SET @has_gd_slot := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail' AND COLUMN_NAME = 'cln_ttlock_slot'
);
SET @sql_gd := IF(
  @has_gd > 0 AND @has_gd_slot = 0,
  'ALTER TABLE gatewaydetail ADD COLUMN cln_ttlock_slot INT NOT NULL DEFAULT 0 COMMENT ''Cleanlemons client: which TTLock account slot'' AFTER cln_clientid',
  'SELECT 1'
);
PREPARE s7 FROM @sql_gd;
EXECUTE s7;
DEALLOCATE PREPARE s7;
