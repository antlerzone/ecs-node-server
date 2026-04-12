-- Cleanlemons: client-portal ownership flag + premises/security/photos/smartdoor on cln_property.
-- Run: node scripts/run-migration.js src/db/migrations/0224_cln_property_portal_binding_and_media.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

-- 1) client_portal_owned: 1 = B2B client portal created → operator cannot change/disconnect clientdetail binding
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'client_portal_owned'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `client_portal_owned` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=client portal created locks operator binding'' AFTER `clientdetail_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) premises_type (landed | apartment | office | commercial | other)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'premises_type'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `premises_type` VARCHAR(32) NULL AFTER `property_name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) security_system
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'security_system'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `security_system` VARCHAR(32) NULL AFTER `mailbox_password`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) smartdoor_password (separate from mailbox)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'smartdoor_password'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `smartdoor_password` TEXT NULL AFTER `security_system`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'smartdoor_token_enabled'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `smartdoor_token_enabled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `smartdoor_password`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5) Photo URLs (OSS)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'after_clean_photo_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `after_clean_photo_url` TEXT NULL AFTER `smartdoor_token_enabled`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'key_photo_url'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `key_photo_url` TEXT NULL AFTER `after_clean_photo_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
