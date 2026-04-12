-- lockdetail / gatewaydetail: separate Cleanlemons scope from Coliving operatordetail (client_id).
-- client_id     = Coliving operatordetail.id only (property/smart door in Coliving portal).
-- cln_clientid  = cln_clientdetail.id (B2B client portal + bridge from Coliving integrate).
-- cln_operatorid = cln_operatordetail.id (Cleanlemons operator portal).
-- Backfill: rows whose client_id matched cln_* master tables move into cln_* columns and clear client_id.

SET NAMES utf8mb4;

SET @db = DATABASE();

SET @has_ld := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail'
);
SET @has_gd := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail'
);
SET @has_cln_cd := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_clientdetail'
);
SET @has_cln_op := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_operatordetail'
);

-- lockdetail: add columns if missing
SET @sql := IF(@has_ld > 0 AND NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail' AND COLUMN_NAME = 'cln_clientid'
), 'ALTER TABLE `lockdetail` ADD COLUMN `cln_clientid` varchar(36) NULL DEFAULT NULL AFTER `client_id`, ADD KEY `idx_lockdetail_cln_clientid` (`cln_clientid`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_ld > 0 AND NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail' AND COLUMN_NAME = 'cln_operatorid'
), 'ALTER TABLE `lockdetail` ADD COLUMN `cln_operatorid` varchar(36) NULL DEFAULT NULL AFTER `cln_clientid`, ADD KEY `idx_lockdetail_cln_operatorid` (`cln_operatorid`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- gatewaydetail
SET @sql := IF(@has_gd > 0 AND NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail' AND COLUMN_NAME = 'cln_clientid'
), 'ALTER TABLE `gatewaydetail` ADD COLUMN `cln_clientid` varchar(36) NULL DEFAULT NULL AFTER `client_id`, ADD KEY `idx_gatewaydetail_cln_clientid` (`cln_clientid`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_gd > 0 AND NOT EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail' AND COLUMN_NAME = 'cln_operatorid'
), 'ALTER TABLE `gatewaydetail` ADD COLUMN `cln_operatorid` varchar(36) NULL DEFAULT NULL AFTER `cln_clientid`, ADD KEY `idx_gatewaydetail_cln_operatorid` (`cln_operatorid`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill lockdetail: cln_clientdetail first
SET @sql := IF(@has_ld > 0 AND @has_cln_cd > 0,
  'UPDATE `lockdetail` l INNER JOIN `cln_clientdetail` c ON c.id = l.client_id SET l.cln_clientid = l.client_id, l.client_id = NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_ld > 0 AND @has_cln_op > 0,
  'UPDATE `lockdetail` l INNER JOIN `cln_operatordetail` o ON o.id = l.client_id SET l.cln_operatorid = l.client_id, l.client_id = NULL WHERE l.cln_clientid IS NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill gatewaydetail
SET @sql := IF(@has_gd > 0 AND @has_cln_cd > 0,
  'UPDATE `gatewaydetail` g INNER JOIN `cln_clientdetail` c ON c.id = g.client_id SET g.cln_clientid = g.client_id, g.client_id = NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_gd > 0 AND @has_cln_op > 0,
  'UPDATE `gatewaydetail` g INNER JOIN `cln_operatordetail` o ON o.id = g.client_id SET g.cln_operatorid = g.client_id, g.client_id = NULL WHERE g.cln_clientid IS NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
