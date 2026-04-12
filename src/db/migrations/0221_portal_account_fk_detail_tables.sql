-- Link portal_account to domain detail rows (FK) for auto-provision on portal login.
-- Cleanlemons: cln_clientdetail.portal_account_id
-- Coliving: tenantdetail.portal_account_id, ownerdetail.portal_account_id

SET NAMES utf8mb4;

SET @db = DATABASE();

-- cln_clientdetail.portal_account_id
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_clientdetail' AND COLUMN_NAME = 'portal_account_id'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE `cln_clientdetail` ADD COLUMN `portal_account_id` CHAR(36) NULL COMMENT ''FK portal_account.id'' AFTER `account`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_clientdetail' AND CONSTRAINT_NAME = 'fk_cln_clientdetail_portal_account'
);
SET @sqlfk := IF(
  @fk = 0,
  'ALTER TABLE `cln_clientdetail` ADD CONSTRAINT `fk_cln_clientdetail_portal_account` FOREIGN KEY (`portal_account_id`) REFERENCES `portal_account` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt2 FROM @sqlfk;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_clientdetail' AND INDEX_NAME = 'idx_cln_clientdetail_portal_account_id'
);
SET @sqlidx := IF(
  @idx = 0,
  'ALTER TABLE `cln_clientdetail` ADD KEY `idx_cln_clientdetail_portal_account_id` (`portal_account_id`)',
  'SELECT 1'
);
PREPARE stmt3 FROM @sqlidx;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;

-- tenantdetail.portal_account_id
SET @has2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tenantdetail' AND COLUMN_NAME = 'portal_account_id'
);
SET @sqlt := IF(
  @has2 = 0,
  'ALTER TABLE `tenantdetail` ADD COLUMN `portal_account_id` CHAR(36) NULL COMMENT ''FK portal_account.id'' AFTER `email`',
  'SELECT 1'
);
PREPARE stmt4 FROM @sqlt;
EXECUTE stmt4;
DEALLOCATE PREPARE stmt4;

SET @fkt := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tenantdetail' AND CONSTRAINT_NAME = 'fk_tenantdetail_portal_account'
);
SET @sqlfkt := IF(
  @fkt = 0,
  'ALTER TABLE `tenantdetail` ADD CONSTRAINT `fk_tenantdetail_portal_account` FOREIGN KEY (`portal_account_id`) REFERENCES `portal_account` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt5 FROM @sqlfkt;
EXECUTE stmt5;
DEALLOCATE PREPARE stmt5;

SET @idxt := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tenantdetail' AND INDEX_NAME = 'idx_tenantdetail_portal_account_id'
);
SET @sqlidxt := IF(
  @idxt = 0,
  'ALTER TABLE `tenantdetail` ADD KEY `idx_tenantdetail_portal_account_id` (`portal_account_id`)',
  'SELECT 1'
);
PREPARE stmt6 FROM @sqlidxt;
EXECUTE stmt6;
DEALLOCATE PREPARE stmt6;

-- ownerdetail.portal_account_id
SET @has3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ownerdetail' AND COLUMN_NAME = 'portal_account_id'
);
SET @sqlo := IF(
  @has3 = 0,
  'ALTER TABLE `ownerdetail` ADD COLUMN `portal_account_id` CHAR(36) NULL COMMENT ''FK portal_account.id'' AFTER `email`',
  'SELECT 1'
);
PREPARE stmt7 FROM @sqlo;
EXECUTE stmt7;
DEALLOCATE PREPARE stmt7;

SET @fko := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ownerdetail' AND CONSTRAINT_NAME = 'fk_ownerdetail_portal_account'
);
SET @sqlfko := IF(
  @fko = 0,
  'ALTER TABLE `ownerdetail` ADD CONSTRAINT `fk_ownerdetail_portal_account` FOREIGN KEY (`portal_account_id`) REFERENCES `portal_account` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt8 FROM @sqlfko;
EXECUTE stmt8;
DEALLOCATE PREPARE stmt8;

SET @idxo := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'ownerdetail' AND INDEX_NAME = 'idx_ownerdetail_portal_account_id'
);
SET @sqlidxo := IF(
  @idxo = 0,
  'ALTER TABLE `ownerdetail` ADD KEY `idx_ownerdetail_portal_account_id` (`portal_account_id`)',
  'SELECT 1'
);
PREPARE stmt9 FROM @sqlidxo;
EXECUTE stmt9;
DEALLOCATE PREPARE stmt9;
