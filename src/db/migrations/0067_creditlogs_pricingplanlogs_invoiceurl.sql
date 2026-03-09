-- Billing 頁 #buttoninvoiceeventlogs 需打開開單 URL，寫入 creditlogs / pricingplanlogs 供 getStatementItems 回傳 invoiceUrl。
-- Idempotent: 忽略 ER_DUP_FIELDNAME (1060)。

ALTER TABLE creditlogs ADD COLUMN invoiceurl varchar(512) DEFAULT NULL;
ALTER TABLE pricingplanlogs ADD COLUMN invoiceurl varchar(512) DEFAULT NULL;
