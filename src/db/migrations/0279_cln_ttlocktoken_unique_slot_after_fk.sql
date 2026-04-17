-- Completes 0276 if it stopped at: cannot drop uq_cln_ttlocktoken_clientdetail (FK uses that index).
-- Order: DROP FK → DROP old UNIQUE → ADD composite UNIQUE → ADD FK again.

SET NAMES utf8mb4;
SET @db = DATABASE();

SET @has_tt := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
);

-- slot column (idempotent)
SET @col_slot := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND COLUMN_NAME = 'slot'
);
SET @sql_slot := IF(
  @has_tt > 0 AND @col_slot = 0,
  'ALTER TABLE cln_ttlocktoken ADD COLUMN slot INT NOT NULL DEFAULT 0 AFTER clientdetail_id',
  'SELECT 1'
);
PREPARE s0 FROM @sql_slot;
EXECUTE s0;
DEALLOCATE PREPARE s0;

-- Drop FK that depends on the old unique on clientdetail_id
SET @has_fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
    AND CONSTRAINT_NAME = 'fk_cln_ttlocktoken_clientdetail' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_drop_fk := IF(
  @has_tt > 0 AND @has_fk > 0,
  'ALTER TABLE cln_ttlocktoken DROP FOREIGN KEY fk_cln_ttlocktoken_clientdetail',
  'SELECT 1'
);
PREPARE s1 FROM @sql_drop_fk;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @has_uq_cd := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_clientdetail'
);
SET @sql_drop_uq := IF(
  @has_tt > 0 AND @has_uq_cd > 0,
  'ALTER TABLE cln_ttlocktoken DROP INDEX uq_cln_ttlocktoken_clientdetail',
  'SELECT 1'
);
PREPARE s2 FROM @sql_drop_uq;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SET @has_uq_cs := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_cdetail_slot'
);
SET @sql_add_uq := IF(
  @has_tt > 0 AND @has_uq_cs = 0,
  'ALTER TABLE cln_ttlocktoken ADD UNIQUE KEY uq_cln_ttlocktoken_cdetail_slot (clientdetail_id, slot)',
  'SELECT 1'
);
PREPARE s3 FROM @sql_add_uq;
EXECUTE s3;
DEALLOCATE PREPARE s3;

SET @has_fk2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_ttlocktoken'
    AND CONSTRAINT_NAME = 'fk_cln_ttlocktoken_clientdetail' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql_add_fk := IF(
  @has_tt > 0 AND @has_fk2 = 0,
  'ALTER TABLE cln_ttlocktoken ADD CONSTRAINT fk_cln_ttlocktoken_clientdetail FOREIGN KEY (clientdetail_id) REFERENCES cln_clientdetail (id) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE s4 FROM @sql_add_fk;
EXECUTE s4;
DEALLOCATE PREPARE s4;
