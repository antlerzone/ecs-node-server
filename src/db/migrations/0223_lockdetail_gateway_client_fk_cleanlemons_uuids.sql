-- Allow lockdetail / gatewaydetail.client_id to store Cleanlemons UUIDs
-- (cln_operatordetail.id / cln_clientdetail.id) for TTLock + portal smart door.
-- Coliving rows continue to use operatordetail / clientdetail ids as today.
-- Idempotent: skips if constraint missing or table missing.

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

SET @fk_ld := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'lockdetail'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_lockdetail_client'
  LIMIT 1
);
SET @sql_ld := IF(@has_ld > 0 AND @fk_ld IS NOT NULL,
  'ALTER TABLE `lockdetail` DROP FOREIGN KEY `fk_lockdetail_client`',
  'SELECT 1');
PREPARE stmt_ld FROM @sql_ld;
EXECUTE stmt_ld;
DEALLOCATE PREPARE stmt_ld;

SET @fk_gd := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'gatewaydetail'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_gatewaydetail_client'
  LIMIT 1
);
SET @sql_gd := IF(@has_gd > 0 AND @fk_gd IS NOT NULL,
  'ALTER TABLE `gatewaydetail` DROP FOREIGN KEY `fk_gatewaydetail_client`',
  'SELECT 1');
PREPARE stmt_gd FROM @sql_gd;
EXECUTE stmt_gd;
DEALLOCATE PREPARE stmt_gd;
