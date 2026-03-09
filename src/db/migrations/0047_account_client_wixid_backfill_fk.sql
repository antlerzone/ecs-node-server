-- account: client_wixid 可能是 ["817f6510-..."] 数组形式，规范为单值并回填 client_id，确保 FK 存在。
-- 约定：一律用 client_id (FK → clientdetail.id)，account_json 内 clientId 可能是 wix_id 或 client_id，Node 兼容两种。

-- 1) 把 client_wixid 从 ["uuid"] 或 ["a","b"] 规范为第一个 UUID 字符串（去 [ ] " ，取逗号前）
UPDATE account
SET client_wixid = TRIM(
  SUBSTRING_INDEX(
    TRIM(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(client_wixid, '')), '[', ''), ']', ''), '"', '')),
    ',', 1
  )
)
WHERE client_wixid IS NOT NULL AND TRIM(client_wixid) != ''
  AND (client_wixid LIKE '[%' OR client_wixid LIKE '%]');

-- 2) 用 client_wixid 对焦 clientdetail.wix_id，回填 client_id
UPDATE account t
INNER JOIN clientdetail c ON TRIM(COALESCE(c.wix_id, '')) = TRIM(t.client_wixid)
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- 3) 若不存在 FK，则添加 account.client_id -> clientdetail(id)
SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account' AND CONSTRAINT_NAME = 'fk_account_client');
SET @add_fk_sql = IF(@has_fk = 0, 'ALTER TABLE account ADD CONSTRAINT fk_account_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @add_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
