-- Coliving ↔ Cleanlemons: OAuth handoff nonce + cln_property → Coliving property/room FKs.
-- Idempotent. Skips when referenced tables missing (Coliving-only DB).

SET NAMES utf8mb4;
SET @db = DATABASE();

CREATE TABLE IF NOT EXISTS `cleanlemons_coliving_oauth_state` (
  `nonce` CHAR(36) NOT NULL,
  `operatordetail_id` CHAR(36) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  PRIMARY KEY (`nonce`),
  KEY `idx_cleanlemons_coliving_oauth_exp` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- cln_property: link back to Coliving propertydetail / roomdetail (same MySQL instance)
SET @has_col_pd := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'coliving_propertydetail_id'
);
SET @sql_col_pd := IF(
  @has_col_pd = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `coliving_propertydetail_id` VARCHAR(36) NULL COMMENT ''FK propertydetail.id (Coliving)''',
  'SELECT 1'
);
PREPARE stmt_col_pd FROM @sql_col_pd;
EXECUTE stmt_col_pd;
DEALLOCATE PREPARE stmt_col_pd;

SET @has_col_rd := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'coliving_roomdetail_id'
);
SET @sql_col_rd := IF(
  @has_col_rd = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `coliving_roomdetail_id` VARCHAR(36) NULL COMMENT ''FK roomdetail.id Coliving — NULL means entire unit row''',
  'SELECT 1'
);
PREPARE stmt_col_rd FROM @sql_col_rd;
EXECUTE stmt_col_rd;
DEALLOCATE PREPARE stmt_col_rd;

SET @has_idx_pd := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_coliving_propertydetail_id'
);
SET @sql_idx_pd := IF(
  @has_idx_pd = 0,
  'CREATE INDEX `idx_cln_property_coliving_propertydetail_id` ON `cln_property` (`coliving_propertydetail_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_pd FROM @sql_idx_pd;
EXECUTE stmt_idx_pd;
DEALLOCATE PREPARE stmt_idx_pd;

SET @has_idx_rd := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_coliving_roomdetail_id'
);
SET @sql_idx_rd := IF(
  @has_idx_rd = 0,
  'CREATE INDEX `idx_cln_property_coliving_roomdetail_id` ON `cln_property` (`coliving_roomdetail_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_rd FROM @sql_idx_rd;
EXECUTE stmt_idx_rd;
DEALLOCATE PREPARE stmt_idx_rd;

SET @pd_exists := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'propertydetail'
);
SET @rd_exists := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'roomdetail'
);

SET @has_fk_pd := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND CONSTRAINT_NAME = 'fk_cln_property_coliving_propertydetail'
);
SET @sql_fk_pd := IF(
  @pd_exists > 0 AND @has_fk_pd = 0,
  'ALTER TABLE `cln_property` ADD CONSTRAINT `fk_cln_property_coliving_propertydetail` FOREIGN KEY (`coliving_propertydetail_id`) REFERENCES `propertydetail`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk_pd FROM @sql_fk_pd;
EXECUTE stmt_fk_pd;
DEALLOCATE PREPARE stmt_fk_pd;

SET @has_fk_rd := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND CONSTRAINT_NAME = 'fk_cln_property_coliving_roomdetail'
);
SET @sql_fk_rd := IF(
  @rd_exists > 0 AND @has_fk_rd = 0,
  'ALTER TABLE `cln_property` ADD CONSTRAINT `fk_cln_property_coliving_roomdetail` FOREIGN KEY (`coliving_roomdetail_id`) REFERENCES `roomdetail`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk_rd FROM @sql_fk_rd;
EXECUTE stmt_fk_rd;
DEALLOCATE PREPARE stmt_fk_rd;
