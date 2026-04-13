-- Coliving: distinguish public listing as single room vs whole unit (one row in roomdetail).
-- Default 'room' keeps existing rows behaving as before.

SET @db = DATABASE();

SET @has = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'roomdetail' AND COLUMN_NAME = 'listing_scope'
);
SET @sql = IF(
  @has = 0,
  "ALTER TABLE `roomdetail` ADD COLUMN `listing_scope` ENUM('room', 'entire_unit') NOT NULL DEFAULT 'room' COMMENT 'Public listing: single room vs entire unit' AFTER `roomname`",
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
