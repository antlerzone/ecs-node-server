-- 平台 SaaS Bukku：每個 client 對應一個 contact，開 cash invoice 時用此 contact_id。
-- Idempotent: 忽略 ER_DUP_FIELDNAME (1060)。

ALTER TABLE clientdetail ADD COLUMN bukku_saas_contact_id INT NULL;
