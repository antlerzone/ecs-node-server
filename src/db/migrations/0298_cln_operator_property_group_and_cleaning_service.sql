-- Operator-only property groups (independent of client portal `cln_property_group`).
-- + Service key for operator cleaning price (which pricing "Services provider" line applies to).
-- Run: node scripts/run-migration.js src/db/migrations/0298_cln_operator_property_group_and_cleaning_service.sql

SET @db = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_cleaning_pricing_service'
    ),
    'SELECT 1',
    'ALTER TABLE `cln_property` ADD COLUMN `operator_cleaning_pricing_service` VARCHAR(32) NULL COMMENT ''Pricing ServiceKey (general, homestay, …)'' AFTER `operator_cleaning_price_myr`'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @t := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_property_group'
);
SET @sql2 := IF(@t = 0,
  'CREATE TABLE `cln_operator_property_group` (
    `id` CHAR(36) NOT NULL,
    `operator_id` CHAR(36) NOT NULL COMMENT ''FK cln_operatordetail'',
    `name` VARCHAR(255) NOT NULL DEFAULT '''',
    `created_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    KEY `idx_cln_opg_op` (`operator_id`),
    CONSTRAINT `fk_cln_opg_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @t2 := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operator_property_group_property'
);
SET @sql3 := IF(@t2 = 0,
  'CREATE TABLE `cln_operator_property_group_property` (
    `group_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NULL,
    PRIMARY KEY (`group_id`, `property_id`),
    UNIQUE KEY `uq_cln_opgp_property` (`property_id`),
    KEY `idx_cln_opgp_group` (`group_id`),
    CONSTRAINT `fk_cln_opgp_group` FOREIGN KEY (`group_id`) REFERENCES `cln_operator_property_group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_opgp_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
