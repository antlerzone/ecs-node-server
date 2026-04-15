-- Singpass / MyDigital ID OIDC link columns on portal_account (one sub per provider, optional lock).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

-- singpass_sub
SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'singpass_sub'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `singpass_sub` VARCHAR(255) NULL COMMENT 'Singpass OIDC sub' AFTER `facebook_id`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- mydigital_sub
SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'mydigital_sub'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `mydigital_sub` VARCHAR(255) NULL COMMENT 'MyDigital Keycloak OIDC sub' AFTER `singpass_sub`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- gov_identity_locked
SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'gov_identity_locked'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `gov_identity_locked` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=entity/id/legal/nric locked after Gov OIDC' AFTER `mydigital_sub`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- singpass_linked_at
SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'singpass_linked_at'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `singpass_linked_at` DATETIME NULL AFTER `gov_identity_locked`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- mydigital_linked_at
SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'mydigital_linked_at'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `mydigital_linked_at` DATETIME NULL AFTER `singpass_linked_at`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Unique indexes (ignore duplicate migration)
SET @has = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND INDEX_NAME = 'uk_portal_account_singpass_sub'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD UNIQUE KEY `uk_portal_account_singpass_sub` (`singpass_sub`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND INDEX_NAME = 'uk_portal_account_mydigital_sub'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD UNIQUE KEY `uk_portal_account_mydigital_sub` (`mydigital_sub`)",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
