-- Cleanlemons B2B client-scoped integrations (TTLock, Coliving bridge, etc.) — keyed by cln_clientdetail.id.
-- Complements cln_operator_integration (cleaning company / operator scope).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_client_integration` (
  `id` VARCHAR(64) NOT NULL,
  `clientdetail_id` CHAR(36) NOT NULL COMMENT 'FK cln_clientdetail.id (B2B customer / building client)',
  `key` VARCHAR(64) NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `slot` INT NOT NULL DEFAULT 0,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `provider` VARCHAR(64) NOT NULL,
  `values_json` LONGTEXT NOT NULL,
  `einvoice` TINYINT(1) NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cln_client_integration` (`clientdetail_id`, `key`, `provider`),
  KEY `idx_cln_client_integration_clientdetail` (`clientdetail_id`),
  CONSTRAINT `fk_cln_client_integration_clientdetail`
    FOREIGN KEY (`clientdetail_id`) REFERENCES `cln_clientdetail` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
