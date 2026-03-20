-- Remove legacy ownerdetail.client_id / ownerdetail.property_id after junction cutover.
-- Source of truth:
--   owner_client (owner <-> client)
--   owner_property (owner <-> property)
--   propertydetail.owner_id (property owner)
--
-- This migration is idempotent.

-- Drop FK on ownerdetail.client_id if present
SET @fk_client := (
  SELECT kcu.CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE kcu
  WHERE kcu.TABLE_SCHEMA = DATABASE()
    AND kcu.TABLE_NAME = 'ownerdetail'
    AND kcu.COLUMN_NAME = 'client_id'
    AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql_fk_client := IF(
  @fk_client IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE ownerdetail DROP FOREIGN KEY `', @fk_client, '`')
);
PREPARE stmt_fk_client FROM @sql_fk_client;
EXECUTE stmt_fk_client;
DEALLOCATE PREPARE stmt_fk_client;

-- Drop FK on ownerdetail.property_id if present
SET @fk_property := (
  SELECT kcu.CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE kcu
  WHERE kcu.TABLE_SCHEMA = DATABASE()
    AND kcu.TABLE_NAME = 'ownerdetail'
    AND kcu.COLUMN_NAME = 'property_id'
    AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql_fk_property := IF(
  @fk_property IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE ownerdetail DROP FOREIGN KEY `', @fk_property, '`')
);
PREPARE stmt_fk_property FROM @sql_fk_property;
EXECUTE stmt_fk_property;
DEALLOCATE PREPARE stmt_fk_property;

-- Drop index idx_ownerdetail_client_id if present
SET @has_idx_client := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS s
  WHERE s.TABLE_SCHEMA = DATABASE()
    AND s.TABLE_NAME = 'ownerdetail'
    AND s.INDEX_NAME = 'idx_ownerdetail_client_id'
);
SET @sql_idx_client := IF(
  @has_idx_client = 0,
  'SELECT 1',
  'ALTER TABLE ownerdetail DROP INDEX `idx_ownerdetail_client_id`'
);
PREPARE stmt_idx_client FROM @sql_idx_client;
EXECUTE stmt_idx_client;
DEALLOCATE PREPARE stmt_idx_client;

-- Drop index idx_ownerdetail_property_id if present
SET @has_idx_property := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS s
  WHERE s.TABLE_SCHEMA = DATABASE()
    AND s.TABLE_NAME = 'ownerdetail'
    AND s.INDEX_NAME = 'idx_ownerdetail_property_id'
);
SET @sql_idx_property := IF(
  @has_idx_property = 0,
  'SELECT 1',
  'ALTER TABLE ownerdetail DROP INDEX `idx_ownerdetail_property_id`'
);
PREPARE stmt_idx_property FROM @sql_idx_property;
EXECUTE stmt_idx_property;
DEALLOCATE PREPARE stmt_idx_property;

-- Finally drop legacy columns (compatible with MySQL variants without DROP COLUMN IF EXISTS)
SET @has_col_client := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = DATABASE()
    AND c.TABLE_NAME = 'ownerdetail'
    AND c.COLUMN_NAME = 'client_id'
);
SET @sql_drop_client := IF(
  @has_col_client = 0,
  'SELECT 1',
  'ALTER TABLE ownerdetail DROP COLUMN `client_id`'
);
PREPARE stmt_drop_client FROM @sql_drop_client;
EXECUTE stmt_drop_client;
DEALLOCATE PREPARE stmt_drop_client;

SET @has_col_property := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = DATABASE()
    AND c.TABLE_NAME = 'ownerdetail'
    AND c.COLUMN_NAME = 'property_id'
);
SET @sql_drop_property := IF(
  @has_col_property = 0,
  'SELECT 1',
  'ALTER TABLE ownerdetail DROP COLUMN `property_id`'
);
PREPARE stmt_drop_property FROM @sql_drop_property;
EXECUTE stmt_drop_property;
DEALLOCATE PREPARE stmt_drop_property;
