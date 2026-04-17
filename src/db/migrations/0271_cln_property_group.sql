-- Cleanlemons B2B: property groups (operator-bound), shared members by email, per-member create/edit/delete.
-- Run: node scripts/run-migration.js src/db/migrations/0271_cln_property_group.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

-- ─── cln_property_group ───────────────────────────────────────────────────
SET @t := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group'
);
SET @sql := IF(@t = 0,
  'CREATE TABLE `cln_property_group` (
    `id` CHAR(36) NOT NULL,
    `owner_clientdetail_id` CHAR(36) NOT NULL COMMENT ''FK cln_clientdetail — billing / primary tenant'',
    `operator_id` CHAR(36) NOT NULL COMMENT ''FK cln_operatordetail'',
    `name` VARCHAR(255) NOT NULL DEFAULT '''',
    `created_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    KEY `idx_cln_pg_owner` (`owner_clientdetail_id`),
    KEY `idx_cln_pg_operator` (`operator_id`),
    CONSTRAINT `fk_cln_pg_owner` FOREIGN KEY (`owner_clientdetail_id`) REFERENCES `cln_clientdetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_pg_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── cln_property_group_property (one property in at most one group) ──────
SET @t2 := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_property'
);
SET @sql2 := IF(@t2 = 0,
  'CREATE TABLE `cln_property_group_property` (
    `group_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NULL,
    PRIMARY KEY (`group_id`, `property_id`),
    UNIQUE KEY `uq_cln_pgp_property` (`property_id`),
    KEY `idx_cln_pgp_group` (`group_id`),
    CONSTRAINT `fk_cln_pgp_group` FOREIGN KEY (`group_id`) REFERENCES `cln_property_group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_pgp_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ─── cln_property_group_member ─────────────────────────────────────────────
SET @t3 := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_group_member'
);
SET @sql3 := IF(@t3 = 0,
  'CREATE TABLE `cln_property_group_member` (
    `id` CHAR(36) NOT NULL,
    `group_id` CHAR(36) NOT NULL,
    `grantee_clientdetail_id` CHAR(36) NULL COMMENT ''Set when invite accepted'',
    `invite_email` VARCHAR(255) NOT NULL,
    `invite_status` ENUM(''pending'', ''active'', ''revoked'') NOT NULL DEFAULT ''pending'',
    `can_create` TINYINT(1) NOT NULL DEFAULT 0,
    `can_edit` TINYINT(1) NOT NULL DEFAULT 0,
    `can_delete` TINYINT(1) NOT NULL DEFAULT 0,
    `invited_at` DATETIME(3) NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_cln_pgm_group_email` (`group_id`, `invite_email`(191)),
    KEY `idx_cln_pgm_group` (`group_id`),
    KEY `idx_cln_pgm_grantee` (`grantee_clientdetail_id`),
    KEY `idx_cln_pgm_status` (`invite_status`),
    CONSTRAINT `fk_cln_pgm_group` FOREIGN KEY (`group_id`) REFERENCES `cln_property_group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_pgm_grantee` FOREIGN KEY (`grantee_clientdetail_id`) REFERENCES `cln_clientdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- Optional: schedule row remembers which client portal group context created it (filter/audit)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND COLUMN_NAME = 'client_portal_group_id'
);
SET @sqlc := IF(@col = 0,
  'ALTER TABLE `cln_schedule` ADD COLUMN `client_portal_group_id` CHAR(36) NULL COMMENT ''FK cln_property_group when job created via group'' AFTER `property_id`',
  'SELECT 1'
);
PREPARE stmt4 FROM @sqlc; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;

SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_schedule' AND CONSTRAINT_NAME = 'fk_cln_schedule_client_portal_group'
);
SET @sqlfk := IF(@fk = 0,
  'ALTER TABLE `cln_schedule` ADD CONSTRAINT `fk_cln_schedule_client_portal_group` FOREIGN KEY (`client_portal_group_id`) REFERENCES `cln_property_group` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt5 FROM @sqlfk; EXECUTE stmt5; DEALLOCATE PREPARE stmt5;
