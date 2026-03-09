-- supplierdetail 表加 utility_type，用于明确该供应商是电/水/网络，便于 JP Reference 1 取值。
-- 取值：'electric' | 'water' | 'wifi'，NULL 时仍用 title 含 tnb/saj 或 property.internettype_id 推断。
ALTER TABLE supplierdetail
  ADD COLUMN utility_type varchar(20) DEFAULT NULL COMMENT 'electric|water|wifi';
