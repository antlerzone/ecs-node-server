-- Cleanlemons: native property ↔ lockdetail binds (one lock may bind many properties; many locks per property).
-- Run: node scripts/run-migration.js src/db/migrations/0299_cln_property_lock.sql

SET NAMES utf8mb4;
SET @db = DATABASE();

SET @t_exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property_lock'
);
SET @sql = IF(@t_exists = 0,
  'CREATE TABLE `cln_property_lock` (
    `id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `lockdetail_id` VARCHAR(36) NOT NULL,
    `integration_source` VARCHAR(32) NOT NULL DEFAULT ''manual'' COMMENT ''manual | operator_ttlock | client_ttlock | coliving_sync'',
    `ttlock_slot` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_cln_property_lock_prop_lock` (`property_id`, `lockdetail_id`),
    KEY `idx_cln_property_lock_lock` (`lockdetail_id`),
    KEY `idx_cln_property_lock_prop` (`property_id`),
    CONSTRAINT `fk_cln_property_lock_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
