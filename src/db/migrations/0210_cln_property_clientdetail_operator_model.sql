-- Cleanlemons property ownership model:
-- 1) property belongs to cln_clientdetail (clientdetail_id)
-- 2) property is managed by one operator (operator_id)
-- 3) keep legacy client_id for backward compatibility

SET NAMES utf8mb4;

SET @db = DATABASE();

-- 1) columns
SET @has_clientdetail_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'clientdetail_id'
);
SET @sql_clientdetail_col := IF(
  @has_clientdetail_col = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `clientdetail_id` CHAR(36) NULL COMMENT ''FK cln_clientdetail.id (business client owner)'' AFTER `client_id`',
  'SELECT 1'
);
PREPARE stmt_clientdetail_col FROM @sql_clientdetail_col;
EXECUTE stmt_clientdetail_col;
DEALLOCATE PREPARE stmt_clientdetail_col;

SET @has_operator_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_id'
);
SET @sql_operator_col := IF(
  @has_operator_col = 0,
  'ALTER TABLE `cln_property` ADD COLUMN `operator_id` CHAR(36) NULL COMMENT ''FK cln_operatordetail.id (single operator managing this property)'' AFTER `id`',
  'SELECT 1'
);
PREPARE stmt_operator_col FROM @sql_operator_col;
EXECUTE stmt_operator_col;
DEALLOCATE PREPARE stmt_operator_col;

-- 2) indexes
SET @has_idx_operator := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_operator_id'
);
SET @sql_idx_operator := IF(
  @has_idx_operator = 0,
  'CREATE INDEX `idx_cln_property_operator_id` ON `cln_property` (`operator_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_operator FROM @sql_idx_operator;
EXECUTE stmt_idx_operator;
DEALLOCATE PREPARE stmt_idx_operator;

SET @has_idx_clientdetail := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND INDEX_NAME = 'idx_cln_property_clientdetail_id'
);
SET @sql_idx_clientdetail := IF(
  @has_idx_clientdetail = 0,
  'CREATE INDEX `idx_cln_property_clientdetail_id` ON `cln_property` (`clientdetail_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_clientdetail FROM @sql_idx_clientdetail;
EXECUTE stmt_idx_clientdetail;
DEALLOCATE PREPARE stmt_idx_clientdetail;

-- 3) backfill operator_id from legacy client_id if client_id points to cln_operatordetail
UPDATE `cln_property` p
INNER JOIN `cln_operatordetail` o ON o.id = p.client_id
SET p.operator_id = o.id
WHERE p.operator_id IS NULL;

-- 4) backfill clientdetail_id from cc_json.wixClientReference
UPDATE `cln_property`
SET `clientdetail_id` = NULLIF(
  JSON_UNQUOTE(JSON_EXTRACT(`cc_json`, '$.wixClientReference')),
  ''
)
WHERE `clientdetail_id` IS NULL
  AND JSON_VALID(`cc_json`) = 1
  AND JSON_EXTRACT(`cc_json`, '$.wixClientReference') IS NOT NULL;

-- 5) cleanup invalid refs before adding FK
UPDATE `cln_property` p
LEFT JOIN `cln_operatordetail` o ON o.id = p.operator_id
SET p.operator_id = NULL
WHERE p.operator_id IS NOT NULL AND o.id IS NULL;

UPDATE `cln_property` p
LEFT JOIN `cln_clientdetail` c ON c.id = p.clientdetail_id
SET p.clientdetail_id = NULL
WHERE p.clientdetail_id IS NOT NULL AND c.id IS NULL;

-- 6) foreign keys (idempotent)
SET @has_fk_operator := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND CONSTRAINT_NAME = 'fk_cln_property_operator'
);
SET @sql_fk_operator := IF(
  @has_fk_operator = 0,
  'ALTER TABLE `cln_property` ADD CONSTRAINT `fk_cln_property_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk_operator FROM @sql_fk_operator;
EXECUTE stmt_fk_operator;
DEALLOCATE PREPARE stmt_fk_operator;

SET @has_fk_clientdetail := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_property' AND CONSTRAINT_NAME = 'fk_cln_property_clientdetail'
);
SET @sql_fk_clientdetail := IF(
  @has_fk_clientdetail = 0,
  'ALTER TABLE `cln_property` ADD CONSTRAINT `fk_cln_property_clientdetail` FOREIGN KEY (`clientdetail_id`) REFERENCES `cln_clientdetail`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_fk_clientdetail FROM @sql_fk_clientdetail;
EXECUTE stmt_fk_clientdetail;
DEALLOCATE PREPARE stmt_fk_clientdetail;
