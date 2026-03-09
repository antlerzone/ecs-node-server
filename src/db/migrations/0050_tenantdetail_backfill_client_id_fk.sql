-- tenantdetail: backfill client_id from client_wixid (match clientdetail.wix_id), then ensure FK to clientdetail.
-- Run from OS shell: mysql -h HOST -u USER -p DBNAME < 0050_tenantdetail_backfill_client_id_fk.sql

-- 1) Normalize client_wixid: strip "[]" and trim (in case stored as "[uuid]")
UPDATE tenantdetail
SET client_wixid = TRIM(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(client_wixid, '')), '[', ''), ']', ''), '"', ''))
WHERE client_wixid IS NOT NULL AND TRIM(client_wixid) != ''
  AND (client_wixid LIKE '[%' OR client_wixid LIKE '%]' OR client_wixid LIKE '%"%');

-- 2) Backfill client_id: tenantdetail.client_wixid -> clientdetail.wix_id -> clientdetail.id
UPDATE tenantdetail t
INNER JOIN clientdetail c ON TRIM(COALESCE(c.wix_id, '')) = TRIM(COALESCE(t.client_wixid, ''))
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- 3) Add FK tenantdetail.client_id -> clientdetail(id) if missing
SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenantdetail' AND CONSTRAINT_NAME = 'fk_tenantdetail_client');
SET @sql = IF(@has_fk = 0,
  'ALTER TABLE tenantdetail ADD CONSTRAINT fk_tenantdetail_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
