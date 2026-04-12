-- DEPRECATED: superseded by `cln_account` + `cln_account_client` (0185) and dropped by 0186_cleanlemons_drop_legacy_account_template.sql.
-- Cleanlemons Operator Accounting (legacy)
-- Default chart templates + per-client external mapping.
-- Convention: id/FK use *_id columns, CHAR(36) UUID where applicable.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_account_template` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(32) NOT NULL COMMENT 'Internal cleanlemons code shown in UI',
  `title` VARCHAR(255) NOT NULL,
  `account_type` ENUM('income','expense','asset','liability') NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_account_template_code` (`code`),
  KEY `idx_cln_account_template_enabled` (`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_client_account_mapping` (
  `id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NOT NULL COMMENT 'FK cln_client.id',
  `template_id` CHAR(36) NOT NULL COMMENT 'FK cln_account_template.id',
  `external_code` VARCHAR(64) NULL,
  `external_name` VARCHAR(255) NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_client_template` (`client_id`, `template_id`),
  KEY `idx_cln_cam_client_id` (`client_id`),
  KEY `idx_cln_cam_template_id` (`template_id`),
  CONSTRAINT `fk_cln_cam_client`
    FOREIGN KEY (`client_id`) REFERENCES `cln_client` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_cam_template`
    FOREIGN KEY (`template_id`) REFERENCES `cln_account_template` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `cln_account_template`
  (`id`, `code`, `title`, `account_type`, `enabled`, `sort_order`)
VALUES
  ('c0a10000-0000-4000-8000-000000000001', '4000', 'Cleaning Service Revenue', 'income', 1, 10),
  ('c0a10000-0000-4000-8000-000000000002', '5100', 'Staff Salary', 'expense', 1, 20),
  ('c0a10000-0000-4000-8000-000000000003', '5200', 'Cleaning Supplies', 'expense', 1, 30),
  ('c0a10000-0000-4000-8000-000000000004', '5300', 'Driver Allowance', 'expense', 1, 40),
  ('c0a10000-0000-4000-8000-000000000005', '1500', 'Equipment Purchase', 'asset', 1, 50),
  ('c0a10000-0000-4000-8000-000000000006', '2100', 'Client Deposits', 'liability', 0, 60)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `account_type` = VALUES(`account_type`),
  `enabled` = VALUES(`enabled`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP(3);
