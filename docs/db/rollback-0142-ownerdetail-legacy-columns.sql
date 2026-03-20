-- Rollback for 0142_ownerdetail_drop_legacy_client_property.sql
-- Re-create legacy columns on ownerdetail for emergency compatibility.
-- Note: This only restores schema, not historical values.

ALTER TABLE ownerdetail
  ADD COLUMN IF NOT EXISTS client_id varchar(36) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS property_id varchar(36) DEFAULT NULL;

-- Restore legacy indexes (same naming used in old migrations)
SET @has_idx_client := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ownerdetail'
    AND INDEX_NAME = 'idx_ownerdetail_client_id'
);
SET @sql_idx_client := IF(
  @has_idx_client = 0,
  'ALTER TABLE ownerdetail ADD KEY `idx_ownerdetail_client_id` (`client_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_client FROM @sql_idx_client;
EXECUTE stmt_idx_client;
DEALLOCATE PREPARE stmt_idx_client;

SET @has_idx_property := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ownerdetail'
    AND INDEX_NAME = 'idx_ownerdetail_property_id'
);
SET @sql_idx_property := IF(
  @has_idx_property = 0,
  'ALTER TABLE ownerdetail ADD KEY `idx_ownerdetail_property_id` (`property_id`)',
  'SELECT 1'
);
PREPARE stmt_idx_property FROM @sql_idx_property;
EXECUTE stmt_idx_property;
DEALLOCATE PREPARE stmt_idx_property;

-- Optional FK restore (only if parent tables/values are compatible):
-- ALTER TABLE ownerdetail
--   ADD CONSTRAINT fk_ownerdetail_client
--   FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
-- ALTER TABLE ownerdetail
--   ADD CONSTRAINT fk_ownerdetail_property
--   FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
