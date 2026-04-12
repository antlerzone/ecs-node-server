-- Cleanlemons: property link approvals (client ↔ operator).
-- Run: node scripts/run-migration.js src/db/migrations/0227_cln_property_link_request.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_property_link_request` (
  `id` CHAR(36) NOT NULL,
  `kind` VARCHAR(40) NOT NULL COMMENT 'client_requests_operator | operator_requests_client',
  `property_id` CHAR(36) NOT NULL,
  `clientdetail_id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | approved | rejected',
  `payload_json` LONGTEXT NULL,
  `remarks` TEXT NULL,
  `decided_by_email` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decided_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cln_plr_operator_status` (`operator_id`, `status`, `created_at`),
  KEY `idx_cln_plr_client_status` (`clientdetail_id`, `status`, `created_at`),
  KEY `idx_cln_plr_property` (`property_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
