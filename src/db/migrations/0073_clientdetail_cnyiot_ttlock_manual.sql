-- 1 = client 自己登入原有户口 (Existing)，0/NULL = 我们 Create 的子账号。
-- Idempotent: ignore ER_DUP_FIELDNAME (1060).
ALTER TABLE clientdetail ADD COLUMN cnyiot_subuser_manual TINYINT(1) DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN ttlock_manual TINYINT(1) DEFAULT NULL;
