-- Cleanlemons: SaaS master policy for operator-facing AI (schedule / cln_schedule today).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_saasadmin_operator_ai_policy` (
  `id` CHAR(36) NOT NULL,
  `operator_ai_access_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = operators with keys may use schedule AI',
  `allowed_data_scopes_json` LONGTEXT NULL COMMENT 'JSON array of scope keys, e.g. ["cln_schedule"]',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `cln_saasadmin_operator_ai_policy` (`id`, `operator_ai_access_enabled`, `allowed_data_scopes_json`, `updated_at`)
VALUES ('00000000-0000-0000-0000-000000000001', 1, '["cln_schedule"]', CURRENT_TIMESTAMP(3));
