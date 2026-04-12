-- SaaS Admin: dismiss manual top-up / billing ticket rows without deleting the ticket row.
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND COLUMN_NAME = 'acknowledged_at'
);
SET @sql = IF(
  @col = 0,
  'ALTER TABLE ticket ADD COLUMN acknowledged_at datetime NULL DEFAULT NULL COMMENT ''Set when SaaS admin acknowledges/dismisses from pending list''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket' AND INDEX_NAME = 'idx_ticket_acknowledged_at'
);
SET @sql2 = IF(
  @idx = 0,
  'CREATE INDEX idx_ticket_acknowledged_at ON ticket (acknowledged_at)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
