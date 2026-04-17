-- Granular group member permissions: property / booking / status × create, edit, delete.
-- Replaces can_property, can_booking, can_status (each mapped to all three flags in the same domain).
-- Run: node scripts/run-migration.js src/db/migrations/0274_cln_property_group_member_perm_granular.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

-- ─── ADD 9 columns (idempotent) ───────────────────────────────────────────

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_property_create'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_property_create` TINYINT(1) NOT NULL DEFAULT 0 AFTER `invite_status`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_property_edit'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_property_edit` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_property_create`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_property_delete'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_property_delete` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_property_edit`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_booking_create'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_booking_create` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_property_delete`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_booking_edit'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_booking_edit` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_booking_create`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_booking_delete'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_booking_delete` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_booking_edit`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_status_create'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_status_create` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_booking_delete`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_status_edit'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_status_edit` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_status_create`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'perm_status_delete'
);
SET @sql := IF(@c = 0,
  'ALTER TABLE `cln_property_group_member` ADD COLUMN `perm_status_delete` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perm_status_edit`',
  'SELECT 1'
);
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── Backfill from legacy triple (if present) ─────────────────────────────

SET @has_old := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_property'
);
SET @sqlb := IF(@has_old > 0,
  'UPDATE `cln_property_group_member` SET
     `perm_property_create` = IF(`can_property` = 1, 1, 0),
     `perm_property_edit` = IF(`can_property` = 1, 1, 0),
     `perm_property_delete` = IF(`can_property` = 1, 1, 0),
     `perm_booking_create` = IF(`can_booking` = 1, 1, 0),
     `perm_booking_edit` = IF(`can_booking` = 1, 1, 0),
     `perm_booking_delete` = IF(`can_booking` = 1, 1, 0),
     `perm_status_create` = IF(`can_status` = 1, 1, 0),
     `perm_status_edit` = IF(`can_status` = 1, 1, 0),
     `perm_status_delete` = IF(`can_status` = 1, 1, 0)',
  'SELECT 1'
);
PREPARE stb FROM @sqlb; EXECUTE stb; DEALLOCATE PREPARE stb;

-- ─── Drop legacy columns ───────────────────────────────────────────────────

SET @d1 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_property'
);
SET @sqld1 := IF(@d1 > 0,
  'ALTER TABLE `cln_property_group_member` DROP COLUMN `can_property`',
  'SELECT 1'
);
PREPARE std1 FROM @sqld1; EXECUTE std1; DEALLOCATE PREPARE std1;

SET @d2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_booking'
);
SET @sqld2 := IF(@d2 > 0,
  'ALTER TABLE `cln_property_group_member` DROP COLUMN `can_booking`',
  'SELECT 1'
);
PREPARE std2 FROM @sqld2; EXECUTE std2; DEALLOCATE PREPARE std2;

SET @d3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_status'
);
SET @sqld3 := IF(@d3 > 0,
  'ALTER TABLE `cln_property_group_member` DROP COLUMN `can_status`',
  'SELECT 1'
);
PREPARE std3 FROM @sqld3; EXECUTE std3; DEALLOCATE PREPARE std3;
