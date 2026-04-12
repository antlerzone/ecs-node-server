-- Cleanlemons domain model (aligned with Coliving patterns):
-- 1) cln_clientdetail + cln_client_operator — service client (B2B) ↔ many cln_operator (like ownerdetail + owner_client).
-- 2) cln_employeedetail + cln_employee_operator — employee master ↔ many operator, staff_role cleaner|driver|dobi|supervisor (portal operator via supervisor role).
--
-- Note: Historical `cln_client` (0176) was renamed to `cln_operator` (0182). `cln_clientdetail` is a different entity (customer / building client).

SET NAMES utf8mb4;

-- ─── A) Service clients (many operators) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `cln_clientdetail` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NULL,
  `fullname` VARCHAR(512) NULL,
  `phone` VARCHAR(64) NULL,
  `address` TEXT NULL,
  `account` LONGTEXT NULL COMMENT 'JSON: accounting contact refs per provider',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_clientdetail_email` (`email`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_client_operator` (
  `id` CHAR(36) NOT NULL,
  `clientdetail_id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_client_operator` (`clientdetail_id`, `operator_id`),
  KEY `idx_cln_client_operator_operator` (`operator_id`),
  CONSTRAINT `fk_cln_client_operator_clientdetail`
    FOREIGN KEY (`clientdetail_id`) REFERENCES `cln_clientdetail` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_client_operator_operator`
    FOREIGN KEY (`operator_id`) REFERENCES `cln_operator` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── B) cln_employeedetail: rename from cln_employee_profile or create empty ───
DROP PROCEDURE IF EXISTS `migrate_cln_employeedetail_0191`;
DELIMITER //
CREATE PROCEDURE `migrate_cln_employeedetail_0191`()
BEGIN
  DECLARE ep_exists INT DEFAULT 0;
  DECLARE ed_exists INT DEFAULT 0;
  SELECT COUNT(*) INTO ep_exists FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'cln_employee_profile';
  SELECT COUNT(*) INTO ed_exists FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = 'cln_employeedetail';

  IF ep_exists = 1 AND ed_exists = 0 THEN
    ALTER TABLE `cln_employee_profile` DROP FOREIGN KEY `fk_cln_employee_profile_client`;
    RENAME TABLE `cln_employee_profile` TO `cln_employeedetail`;
  ELSEIF ed_exists = 0 THEN
    CREATE TABLE `cln_employeedetail` (
      `id` CHAR(36) NOT NULL,
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
      UNIQUE KEY `uq_cln_employeedetail_email` (`email`(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END //
DELIMITER ;

CALL `migrate_cln_employeedetail_0191`();
DROP PROCEDURE IF EXISTS `migrate_cln_employeedetail_0191`;

-- Junction: employee ↔ operator (staff_role = cleaner | driver | dobi | supervisor)
CREATE TABLE IF NOT EXISTS `cln_employee_operator` (
  `id` CHAR(36) NOT NULL,
  `employee_id` CHAR(36) NOT NULL,
  `operator_id` CHAR(36) NOT NULL,
  `staff_role` VARCHAR(32) NOT NULL DEFAULT 'cleaner' COMMENT 'cleaner|driver|dobi|supervisor',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_employee_operator` (`employee_id`, `operator_id`),
  KEY `idx_cln_employee_operator_op` (`operator_id`),
  CONSTRAINT `fk_cln_emp_op_employee`
    FOREIGN KEY (`employee_id`) REFERENCES `cln_employeedetail` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_emp_op_operator`
    FOREIGN KEY (`operator_id`) REFERENCES `cln_operator` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill junction from legacy client_id column if still present on cln_employeedetail
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cln_employeedetail'
    AND column_name = 'client_id'
);
SET @sql := IF(
  @col_exists > 0,
  'INSERT IGNORE INTO cln_employee_operator (id, employee_id, operator_id, staff_role, created_at)
   SELECT UUID(), id, client_id, ''cleaner'', CURRENT_TIMESTAMP(3) FROM cln_employeedetail
   WHERE client_id IS NOT NULL AND TRIM(client_id) <> ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Drop FK + client_id: see 0192_cln_employeedetail_drop_client_id_fk.sql (must DROP FOREIGN KEY before column).
