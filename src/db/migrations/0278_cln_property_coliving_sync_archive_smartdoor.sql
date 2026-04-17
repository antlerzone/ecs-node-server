-- Cleanlemons cln_property: mirror Coliving smart door lock binding + archive/hidden from Coliving property/room.
-- Run: node scripts/run-migration.js src/db/migrations/0278_cln_property_coliving_sync_archive_smartdoor.sql

SET NAMES utf8mb4;
SET @db = DATABASE();

-- 1) coliving_sync_archived: 1 = hide in client portal (Coliving property archived or room inactive)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'coliving_sync_archived'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `coliving_sync_archived` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=Coliving source archived/inactive — hide in portal'' AFTER `updated_at`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) smartdoor_id: mirror propertydetail/roomdetail.smartdoor_id → lockdetail.id (same DB)
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_property' AND column_name = 'smartdoor_id'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `smartdoor_id` VARCHAR(36) NULL DEFAULT NULL COMMENT ''Coliving lockdetail id mirror'' AFTER `coliving_sync_archived`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'cln_property' AND index_name = 'idx_cln_property_smartdoor_id'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE `cln_property` ADD KEY `idx_cln_property_smartdoor_id` (`smartdoor_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
