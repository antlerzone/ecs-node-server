-- bills: billtype_wixid 指向 supplierdetail；billtype_id 改名为 supplierdetail_id 并 FK 到 supplierdetail
-- 若已无 billtype_id（已改名）则只做回填 + 加 FK

-- 1) 删除指向 billtype_id 的 FK（存在才删）
SET @fk_name = (
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bills'
    AND COLUMN_NAME = 'billtype_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @drop_sql = IF(@fk_name IS NOT NULL, CONCAT('ALTER TABLE bills DROP FOREIGN KEY ', @fk_name), 'SELECT 1');
PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) 仅当存在 billtype_id 时才重命名
SET @has_billtype_id = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND COLUMN_NAME = 'billtype_id');
SET @rename_sql = IF(@has_billtype_id > 0, 'ALTER TABLE bills CHANGE COLUMN billtype_id supplierdetail_id varchar(36) DEFAULT NULL', 'SELECT 1');
PREPARE stmt2 FROM @rename_sql;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 3) 按 billtype_wixid = supplierdetail.wix_id 回填 supplierdetail_id
UPDATE bills b
LEFT JOIN supplierdetail s ON s.wix_id = b.billtype_wixid AND b.billtype_wixid IS NOT NULL AND b.billtype_wixid != ''
SET b.supplierdetail_id = s.id;

-- 4) 仅当不存在 fk_bills_supplierdetail 时才加 FK
SET @has_fk = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills' AND CONSTRAINT_NAME = 'fk_bills_supplierdetail');
SET @add_fk_sql = IF(@has_fk = 0, 'ALTER TABLE bills ADD CONSTRAINT fk_bills_supplierdetail FOREIGN KEY (supplierdetail_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt3 FROM @add_fk_sql;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
