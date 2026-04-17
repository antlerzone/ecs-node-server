-- Rename member permission columns: booking / status / property (was create / edit / delete).
-- Run: node scripts/run-migration.js src/db/migrations/0273_cln_property_group_member_perm_labels.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @c1 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_create'
);
SET @s1 := IF(@c1 > 0,
  'ALTER TABLE `cln_property_group_member` CHANGE COLUMN `can_create` `can_booking` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''create or cancel bookings''',
  'SELECT 1'
);
PREPARE st1 FROM @s1; EXECUTE st1; DEALLOCATE PREPARE st1;

SET @c2 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_edit'
);
SET @s2 := IF(@c2 > 0,
  'ALTER TABLE `cln_property_group_member` CHANGE COLUMN `can_edit` `can_status` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''reschedule and update job status''',
  'SELECT 1'
);
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;

SET @c3 := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member' AND COLUMN_NAME = 'can_delete'
);
SET @s3 := IF(@c3 > 0,
  'ALTER TABLE `cln_property_group_member` CHANGE COLUMN `can_delete` `can_property` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''edit property details / portal fields''',
  'SELECT 1'
);
PREPARE st3 FROM @s3; EXECUTE st3; DEALLOCATE PREPARE st3;
