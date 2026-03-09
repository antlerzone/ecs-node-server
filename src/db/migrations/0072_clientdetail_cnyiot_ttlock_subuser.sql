-- Store CNYIOT/TTLock subuser on clientdetail for easy read. Disconnect only breaks mapping in client_integration.
-- Idempotent: ignore ER_DUP_FIELDNAME (1060).
ALTER TABLE clientdetail ADD COLUMN cnyiot_subuser_id VARCHAR(32) DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN cnyiot_subuser_login VARCHAR(255) DEFAULT NULL;
ALTER TABLE clientdetail ADD COLUMN ttlock_username VARCHAR(255) DEFAULT NULL;
