-- Cleanlemons: staff damage reports per schedule job (OSS photos + remark); client acknowledge.
-- Run: node scripts/run-migration.js src/db/migrations/0230_cln_damage_report.sql

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_damage_report'
);
SET @sql_create := IF(
  @tbl_exists = 0,
  'CREATE TABLE `cln_damage_report` (
    `id` CHAR(36) NOT NULL,
    `schedule_id` CHAR(36) NOT NULL,
    `property_id` CHAR(36) NOT NULL,
    `operator_id` CHAR(36) NOT NULL,
    `staff_email` VARCHAR(255) NOT NULL,
    `remark` TEXT NULL,
    `photos_json` LONGTEXT NULL COMMENT ''JSON array of OSS URLs'',
    `location_json` LONGTEXT NULL COMMENT ''Optional JSON from employee device'',
    `reported_at` DATETIME(3) NOT NULL,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_email` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `idx_cln_damage_report_operator_reported` (`operator_id`, `reported_at`),
    KEY `idx_cln_damage_report_schedule` (`schedule_id`),
    KEY `idx_cln_damage_report_property` (`property_id`),
    KEY `idx_cln_damage_report_client_ack` (`acknowledged_at`),
    CONSTRAINT `fk_cln_damage_report_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `cln_schedule` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_damage_report_property` FOREIGN KEY (`property_id`) REFERENCES `cln_property` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_cln_damage_report_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt_create FROM @sql_create;
EXECUTE stmt_create;
DEALLOCATE PREPARE stmt_create;
