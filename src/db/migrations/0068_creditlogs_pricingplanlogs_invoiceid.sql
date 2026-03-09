-- 開單後寫回平台 Bukku invoice id，供 billing 顯示／追蹤。
-- Idempotent: 忽略 ER_DUP_FIELDNAME (1060)。

ALTER TABLE creditlogs ADD COLUMN invoiceid varchar(100) DEFAULT NULL;
ALTER TABLE pricingplanlogs ADD COLUMN invoiceid varchar(100) DEFAULT NULL;
