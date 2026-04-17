-- Stable human-readable rule id (e.g. 0001) for SaaS admin platform AI rules.

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_saasadmin_ai_md' AND COLUMN_NAME = 'rule_code'
);

SET @sql = IF(@col = 0,
  'ALTER TABLE `cln_saasadmin_ai_md` ADD COLUMN `rule_code` VARCHAR(8) NULL COMMENT ''Stable display id e.g. 0001'' AFTER `id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill existing rows (MySQL 8+)
UPDATE `cln_saasadmin_ai_md` t
INNER JOIN (
  SELECT `id`, LPAD(ROW_NUMBER() OVER (ORDER BY `created_at` ASC, `id` ASC), 4, '0') AS rc
  FROM `cln_saasadmin_ai_md`
) x ON t.`id` = x.`id`
SET t.`rule_code` = x.rc
WHERE t.`rule_code` IS NULL;

ALTER TABLE `cln_saasadmin_ai_md` MODIFY COLUMN `rule_code` VARCHAR(8) NOT NULL;

SET @uk = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_saasadmin_ai_md' AND INDEX_NAME = 'uk_cln_saasadmin_ai_md_rule_code'
);
SET @sql2 = IF(@uk = 0,
  'ALTER TABLE `cln_saasadmin_ai_md` ADD UNIQUE KEY `uk_cln_saasadmin_ai_md_rule_code` (`rule_code`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
