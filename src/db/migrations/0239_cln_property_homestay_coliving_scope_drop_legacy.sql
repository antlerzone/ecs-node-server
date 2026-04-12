-- Cleanlemons: homestay_source_id + coliving_scope; backfill; drop cln_property.client_id / owner_wix_id.
-- Idempotent.

SET NAMES utf8mb4;
SET @db = DATABASE();

-- 1) homestay_source_id (Antlerzone Listing UUID; mirrors legacy source_id for Homestay)
SET @has_hs := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'homestay_source_id'
);
SET @sql_hs := IF(
  @has_hs = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `homestay_source_id` VARCHAR(64) NULL COMMENT ''Homestay/Antlerzone listing id''',
  'SELECT 1'
);
PREPARE stmt_hs FROM @sql_hs;
EXECUTE stmt_hs;
DEALLOCATE PREPARE stmt_hs;

UPDATE `cln_property`
SET `homestay_source_id` = NULLIF(TRIM(`source_id`), '')
WHERE (`homestay_source_id` IS NULL OR TRIM(COALESCE(`homestay_source_id`, '')) = '')
  AND `source_id` IS NOT NULL AND TRIM(`source_id`) <> '';

-- 2) coliving_scope (entire | room) — Coliving sync discriminator
SET @has_cs := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'coliving_scope'
);
SET @sql_cs := IF(
  @has_cs = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `coliving_scope` VARCHAR(16) NULL COMMENT ''entire|room Coliving row kind''',
  'SELECT 1'
);
PREPARE stmt_cs FROM @sql_cs;
EXECUTE stmt_cs;
DEALLOCATE PREPARE stmt_cs;

-- Backfill coliving_source_id + coliving_scope from legacy columns when present
UPDATE `cln_property`
SET `coliving_source_id` = TRIM(`coliving_roomdetail_id`), `coliving_scope` = 'room'
WHERE `coliving_roomdetail_id` IS NOT NULL AND TRIM(`coliving_roomdetail_id`) <> ''
  AND (NULLIF(TRIM(`coliving_source_id`), '') IS NULL OR NULLIF(TRIM(`coliving_scope`), '') IS NULL);

UPDATE `cln_property`
SET `coliving_source_id` = TRIM(`coliving_propertydetail_id`), `coliving_scope` = 'entire'
WHERE (`coliving_roomdetail_id` IS NULL OR TRIM(`coliving_roomdetail_id`) = '')
  AND `coliving_propertydetail_id` IS NOT NULL AND TRIM(`coliving_propertydetail_id`) <> ''
  AND (NULLIF(TRIM(`coliving_source_id`), '') IS NULL OR NULLIF(TRIM(`coliving_scope`), '') IS NULL);

-- 3) Drop owner_wix_id
SET @has_ow := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'owner_wix_id'
);
SET @sql_ow := IF(
  @has_ow > 0,
  'ALTER TABLE `cln_property` DROP COLUMN `owner_wix_id`',
  'SELECT 1'
);
PREPARE stmt_ow FROM @sql_ow;
EXECUTE stmt_ow;
DEALLOCATE PREPARE stmt_ow;

-- 4) Drop FK + client_id on cln_property (legacy Wix cln_client)
SET @has_cid := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'client_id'
);
SET @has_fk_cc := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND CONSTRAINT_NAME = 'fk_cln_property_client'
);
SET @sql_drop_fk := IF(
  @has_cid > 0 AND @has_fk_cc > 0,
  'ALTER TABLE `cln_property` DROP FOREIGN KEY `fk_cln_property_client`',
  'SELECT 1'
);
PREPARE stmt_dfk FROM @sql_drop_fk;
EXECUTE stmt_dfk;
DEALLOCATE PREPARE stmt_dfk;

SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_client'
);
SET @sql_drop_idx := IF(
  @has_cid > 0 AND @has_idx > 0,
  'ALTER TABLE `cln_property` DROP INDEX `idx_cln_property_client`',
  'SELECT 1'
);
PREPARE stmt_dix FROM @sql_drop_idx;
EXECUTE stmt_dix;
DEALLOCATE PREPARE stmt_dix;

SET @sql_drop_cid := IF(
  @has_cid > 0,
  'ALTER TABLE `cln_property` DROP COLUMN `client_id`',
  'SELECT 1'
);
PREPARE stmt_dcid FROM @sql_drop_cid;
EXECUTE stmt_dcid;
DEALLOCATE PREPARE stmt_dcid;

-- 5) Helpful indexes (ignore if exists)
SET @has_ix_hs := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_homestay_operator'
);
SET @sql_ix_hs := IF(
  @has_ix_hs = 0,
  'CREATE INDEX `idx_cln_property_homestay_operator` ON `cln_property` (`homestay_source_id`, `operator_id`)',
  'SELECT 1'
);
PREPARE stmt_ixhs FROM @sql_ix_hs;
EXECUTE stmt_ixhs;
DEALLOCATE PREPARE stmt_ix_hs;
