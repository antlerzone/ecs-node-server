-- Cleanlemons SaaS — employee profile master table (like tenantdetail/ownerdetail).
-- One row per employee email in Cleanlemons portal.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_employee_profile` (
  `id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NULL COMMENT 'FK cln_client.id',
  `email` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(255) NULL,
  `legal_name` VARCHAR(255) NULL,
  `nickname` VARCHAR(255) NULL,
  `phone` VARCHAR(64) NULL,
  `address` TEXT NULL,
  `entity_type` VARCHAR(64) NULL,
  `id_type` VARCHAR(32) NULL,
  `id_number` VARCHAR(128) NULL,
  `tax_id_no` VARCHAR(128) NULL,
  `bank_id` CHAR(36) NULL COMMENT 'bankdetail.id',
  `bank_account_no` VARCHAR(64) NULL,
  `bank_account_holder` VARCHAR(255) NULL,
  `nric_front_url` TEXT NULL,
  `nric_back_url` TEXT NULL,
  `avatar_url` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_employee_profile_email` (`email`(191)),
  KEY `idx_cln_employee_profile_client` (`client_id`),
  CONSTRAINT `fk_cln_employee_profile_client`
    FOREIGN KEY (`client_id`) REFERENCES `cln_client` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
