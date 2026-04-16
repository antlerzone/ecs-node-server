-- Aliyun eKYC_PRO: lock entity / legal / ID fields after OCR auto-fill (parallel to Gov OIDC lock).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'aliyun_ekyc_locked'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `portal_account` ADD COLUMN `aliyun_ekyc_locked` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=eKYC_PRO OCR filled + lock identity fields' AFTER `mydigital_linked_at`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
