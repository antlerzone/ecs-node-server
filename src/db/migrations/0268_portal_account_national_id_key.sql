-- Normalized national id (MY IC / SG NRIC-FIN) for global uniqueness across Singpass, MyKad, passport OCR.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db = DATABASE();

-- 1) Add column national_id_key (nullable; multiple NULLs allowed before backfill)
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND COLUMN_NAME = 'national_id_key'
);
SET @sql := IF(
  @exists = 0,
  'ALTER TABLE `portal_account` ADD COLUMN `national_id_key` VARCHAR(64) NULL COMMENT ''Normalized national id (MY IC / SG FIN); passport may use passport no if IC not extracted'' AFTER `nric`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Backfill from existing nric (display/login column)
UPDATE `portal_account`
SET `national_id_key` = LOWER(
  REPLACE(REPLACE(REPLACE(REPLACE(TRIM(`nric`), '-', ''), ' ', ''), '/', ''), '_', '')
)
WHERE `nric` IS NOT NULL
  AND TRIM(`nric`) != ''
  AND (`national_id_key` IS NULL OR `national_id_key` = '');

-- 3) Resolve duplicate keys: clear national_id_key on all but one row per key (keep lexicographically smallest id)
UPDATE `portal_account` p
INNER JOIN (
  SELECT `national_id_key` AS nk, MIN(`id`) AS keep_id
  FROM `portal_account`
  WHERE `national_id_key` IS NOT NULL AND `national_id_key` != ''
  GROUP BY `national_id_key`
  HAVING COUNT(*) > 1
) x ON p.`national_id_key` = x.nk AND p.`id` <> x.keep_id
SET p.`national_id_key` = NULL;

-- 4) Unique index (MySQL: multiple NULLs allowed)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'portal_account' AND INDEX_NAME = 'uk_portal_account_national_id_key'
);
SET @sql2 := IF(
  @idx = 0,
  'ALTER TABLE `portal_account` ADD UNIQUE KEY `uk_portal_account_national_id_key` (`national_id_key`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
