-- Operator salary: records (Bukku accrual), allowance/deduction lines, pay-day settings (MY payroll).
-- Run: node scripts/run-migration.js src/db/migrations/0283_cln_salary_records.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_salary_record` (
  `id` CHAR(36) NOT NULL,
  `operator_id` VARCHAR(64) NOT NULL,
  `period` VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `team` VARCHAR(255) NOT NULL DEFAULT '',
  `employee_label` VARCHAR(255) NOT NULL DEFAULT '',
  `base_salary` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `net_salary` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `status` ENUM('pending_sync','complete','void','archived') NOT NULL DEFAULT 'pending_sync',
  `bukku_journal_id` VARCHAR(64) NULL,
  `payment_method` VARCHAR(32) NULL,
  `paid_date` DATE NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_salary_op_period` (`operator_id`, `period`),
  KEY `idx_cln_salary_op_status` (`operator_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_salary_line` (
  `id` CHAR(36) NOT NULL,
  `salary_record_id` CHAR(36) NOT NULL,
  `line_kind` ENUM('allowance','deduction') NOT NULL,
  `label` VARCHAR(255) NOT NULL DEFAULT '',
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_salary_line_rec` (`salary_record_id`),
  CONSTRAINT `fk_cln_salary_line_rec`
    FOREIGN KEY (`salary_record_id`) REFERENCES `cln_salary_record` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_operator_salary_settings` (
  `operator_id` VARCHAR(64) NOT NULL,
  `pay_days_json` JSON NOT NULL COMMENT 'Pay days 1 to 31 JSON array Asia Kuala Lumpur',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
