-- SaaS Admin: mark manual top-up / billing ticket as processed (credits applied).
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'completed_at'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE ticket ADD COLUMN completed_at datetime NULL DEFAULT NULL COMMENT ''Set when SaaS admin finishes manual top-up (or billing) for this ticket''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND INDEX_NAME = 'idx_ticket_completed_at'
);
SET @sql2 = IF(
  @idx = 0,
  'CREATE INDEX idx_ticket_completed_at ON ticket (completed_at)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
