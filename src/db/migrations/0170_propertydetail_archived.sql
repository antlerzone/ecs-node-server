SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'propertydetail'
    AND column_name = 'archived'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE propertydetail ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER active',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
