-- supplierdetail：用 client_wixid 对焦 clientdetail.wix_id，回填 client_id（FK 列）；不加表，不删 FK。
-- 若已有 FK fk_supplierdetail_client 则保留；若无则加上。

-- 1) Mapping：client_wixid 对焦 clientdetail.wix_id，回填 client_id。
--    supplierdetail.client_wixid 可能是 '[817f6510-...]' 带方括号，clientdetail.wix_id 是 817f6510-...，故去掉 [] 再匹配。
UPDATE supplierdetail t
INNER JOIN clientdetail c ON TRIM(COALESCE(c.wix_id, '')) = TRIM(REPLACE(REPLACE(TRIM(COALESCE(t.client_wixid, '')), '[', ''), ']', ''))
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- 2) 若不存在 FK，则添加 supplierdetail.client_id -> clientdetail(id)
SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplierdetail' AND CONSTRAINT_NAME = 'fk_supplierdetail_client');
SET @add_fk_sql = IF(@has_fk = 0, 'ALTER TABLE supplierdetail ADD CONSTRAINT fk_supplierdetail_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @add_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
