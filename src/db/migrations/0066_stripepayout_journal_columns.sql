-- stripepayout: 記錄每個 client 的 settlement；做過會計分錄後寫回 journal 欄位，schedule 可依 journal_created_at IS NULL 撈待處理。
-- Idempotent: runner 忽略 ER_DUP_FIELDNAME (1060).

ALTER TABLE stripepayout ADD COLUMN accounting_journal_id varchar(255) DEFAULT NULL;
ALTER TABLE stripepayout ADD COLUMN journal_created_at datetime DEFAULT NULL;
