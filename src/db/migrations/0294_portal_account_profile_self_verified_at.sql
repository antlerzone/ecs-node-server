-- Portal self-attestation: user confirmed profile on file (no Gov OIDC required for gate).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'profile_self_verified_at'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `portal_account` ADD COLUMN `profile_self_verified_at` DATETIME NULL DEFAULT NULL COMMENT ''User confirmed profile (self-verify gate)''',
  'SELECT ''profile_self_verified_at already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
