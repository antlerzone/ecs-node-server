-- Drop unused column link_room_detail_title_fld from roomdetail (Wix migration legacy, not used in app).
-- Idempotent: only drops if column exists.

SET @col = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roomdetail' AND COLUMN_NAME = 'link_room_detail_title_fld');
SET @sql = IF(@col > 0, 'ALTER TABLE roomdetail DROP COLUMN link_room_detail_title_fld', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
