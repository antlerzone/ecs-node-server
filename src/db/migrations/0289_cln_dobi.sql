-- Cleanlemons: Dobi (laundry) — machines, lots, team/item lines, events. All scoped by operator_id.
-- Run: node scripts/run-migration.js src/db/migrations/0289_cln_dobi.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_dobi_operator_config` (
  `operator_id` CHAR(36) NOT NULL,
  `handoff_wash_to_dry_warning_minutes` INT NOT NULL DEFAULT 15,
  `updated_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operator_id`),
  CONSTRAINT `fk_cln_dobi_operator_config_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_item_type` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_item_type_op` (`operator_id`, `active`),
  CONSTRAINT `fk_cln_dobi_item_type_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_machine` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `kind` ENUM('washer','dryer','iron') NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `capacity_pcs` INT NOT NULL DEFAULT 40,
  `round_minutes` INT NOT NULL DEFAULT 45,
  `sort_order` INT NOT NULL DEFAULT 0,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_machine_op_kind` (`operator_id`, `kind`, `active`),
  CONSTRAINT `fk_cln_dobi_machine_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_gas_bottle` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `installed_at_utc` DATETIME(3) NULL,
  `retired_at_utc` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_gas_op` (`operator_id`),
  CONSTRAINT `fk_cln_dobi_gas_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_day` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `business_date` DATE NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'open',
  `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_dobi_day_op_date` (`operator_id`, `business_date`),
  KEY `idx_cln_dobi_day_op` (`operator_id`, `business_date`),
  CONSTRAINT `fk_cln_dobi_day_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_day_team` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `day_id` CHAR(36) NOT NULL,
  `team_name` VARCHAR(255) NOT NULL,
  `expected_pcs` INT NOT NULL DEFAULT 0,
  `remark_json` JSON NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_day_team_day` (`day_id`),
  KEY `idx_cln_dobi_day_team_op` (`operator_id`),
  CONSTRAINT `fk_cln_dobi_day_team_day` FOREIGN KEY (`day_id`) REFERENCES `cln_dobi_day` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_dobi_day_team_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_lot` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `day_id` CHAR(36) NOT NULL,
  `batch_index` SMALLINT NOT NULL DEFAULT 0,
  `stage` ENUM(
    'pending_wash','washing','pending_dry','drying','pending_iron','ironing','ready','returned'
  ) NOT NULL DEFAULT 'pending_wash',
  `machine_id` CHAR(36) NULL,
  `pcs_total` INT NOT NULL DEFAULT 0,
  `skipped` TINYINT(1) NOT NULL DEFAULT 0,
  `planned_end_at_utc` DATETIME(3) NULL,
  `wash_started_at_utc` DATETIME(3) NULL,
  `wash_ended_at_utc` DATETIME(3) NULL,
  `dry_started_at_utc` DATETIME(3) NULL,
  `dry_ended_at_utc` DATETIME(3) NULL,
  `iron_started_at_utc` DATETIME(3) NULL,
  `iron_ended_at_utc` DATETIME(3) NULL,
  `ready_at_utc` DATETIME(3) NULL,
  `returned_at_utc` DATETIME(3) NULL,
  `remark_json` JSON NULL,
  `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_lot_op_day_stage` (`operator_id`, `day_id`, `stage`),
  KEY `idx_cln_dobi_lot_machine` (`machine_id`),
  CONSTRAINT `fk_cln_dobi_lot_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_dobi_lot_day` FOREIGN KEY (`day_id`) REFERENCES `cln_dobi_day` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_dobi_lot_machine` FOREIGN KEY (`machine_id`) REFERENCES `cln_dobi_machine` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_lot_item` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `item_type_id` CHAR(36) NOT NULL,
  `team_name` VARCHAR(255) NOT NULL DEFAULT '',
  `qty` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_lot_item_lot` (`lot_id`),
  KEY `idx_cln_dobi_lot_item_op` (`operator_id`),
  CONSTRAINT `fk_cln_dobi_lot_item_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_dobi_lot_item_lot` FOREIGN KEY (`lot_id`) REFERENCES `cln_dobi_lot` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_dobi_event` (
  `id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NULL,
  `machine_id` CHAR(36) NULL,
  `gas_bottle_id` CHAR(36) NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `delta_minutes` INT NULL,
  `pcs` INT NULL,
  `payload_json` JSON NULL,
  `created_by_email` VARCHAR(255) NOT NULL,
  `created_at_utc` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_dobi_event_op_time` (`operator_id`, `created_at_utc`),
  KEY `idx_cln_dobi_event_lot` (`lot_id`),
  CONSTRAINT `fk_cln_dobi_event_op` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_dobi_event_lot` FOREIGN KEY (`lot_id`) REFERENCES `cln_dobi_lot` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
