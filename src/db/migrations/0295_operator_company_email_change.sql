-- Coliving: pending company (operatordetail) email change — TAC to new address, then 7-day delay before apply.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @texists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'operator_company_email_change'
);
SET @sql = IF(
  @texists = 0,
  "CREATE TABLE `operator_company_email_change` (
    `client_id` CHAR(36) NOT NULL COMMENT 'operatordetail.id',
    `new_email` VARCHAR(255) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `tac_expires_at` DATETIME NOT NULL,
    `status` ENUM('pending_tac', 'scheduled') NOT NULL DEFAULT 'pending_tac',
    `scheduled_effective_at` DATETIME NULL COMMENT 'When status=scheduled: apply migration at or after this time (NOW()+7d at confirm)',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`client_id`),
    KEY `idx_scheduled_effective` (`status`, `scheduled_effective_at`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
