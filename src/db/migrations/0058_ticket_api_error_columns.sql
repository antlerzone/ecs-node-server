-- ticket: 支持 API 报错工单。source=user 为用户提交的 Help/Request/Feedback；source=api_error 为接口返回 ok:false 时自动写入。
-- 写入字段：哪个页面(page)、几时发生(created_at)、点击什么(action_clicked)、哪个 function(function_name)、接口路径(api_path)、原因(reason/description)。
SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'source');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN source varchar(20) NOT NULL DEFAULT ''user'' COMMENT ''user|api_error''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'page');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN page varchar(255) DEFAULT NULL COMMENT ''页面（如 Owner Setting）''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'action_clicked');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN action_clicked varchar(255) DEFAULT NULL COMMENT ''点击什么（如 Save）''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'function_name');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN function_name varchar(255) DEFAULT NULL COMMENT ''前端调用的 function 名''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'api_path');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN api_path varchar(500) DEFAULT NULL COMMENT ''请求的 API 路径''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'api_method');
SET @sql = IF(@col = 0, 'ALTER TABLE ticket ADD COLUMN api_method varchar(10) DEFAULT NULL COMMENT ''HTTP method''', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
