-- When tenancy room_id changes (change room), record time so UI can require a new agreement for the new room.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenancy' AND COLUMN_NAME = 'last_room_change_at');
SET @sql = IF(@col = 0, 'ALTER TABLE tenancy ADD COLUMN last_room_change_at datetime DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
