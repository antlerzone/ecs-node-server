-- Agreement e-sign: store client IP at signing (operator / tenant / owner).
-- ECS may be behind proxy (e.g. apps/webbrowser). App should read X-Forwarded-For or X-Real-IP.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'operator_signed_ip');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN operator_signed_ip varchar(45) DEFAULT NULL COMMENT ''Client IP when staff signed (operatorsign)''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'tenant_signed_ip');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN tenant_signed_ip varchar(45) DEFAULT NULL COMMENT ''Client IP when tenant signed''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agreement' AND COLUMN_NAME = 'owner_signed_ip');
SET @sql = IF(@col = 0, 'ALTER TABLE agreement ADD COLUMN owner_signed_ip varchar(45) DEFAULT NULL COMMENT ''Client IP when owner signed''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
