-- portal_account.phone_verified + pending email change (OTP to new email before migrate).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'phone_verified'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `phone_verified` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=phone OTP verified' AFTER `phone`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @texists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_email_change_pending'
);
SET @sql2 = IF(
  @texists = 0,
  "CREATE TABLE `portal_email_change_pending` (
    `portal_account_id` CHAR(36) NOT NULL,
    `new_email` VARCHAR(255) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `expires_at` DATETIME NOT NULL,
    PRIMARY KEY (`portal_account_id`),
    UNIQUE KEY `uk_portal_email_change_new_email` (`new_email`),
    KEY `idx_expires` (`expires_at`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
