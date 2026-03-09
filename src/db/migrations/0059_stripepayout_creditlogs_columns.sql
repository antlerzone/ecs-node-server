-- stripepayout.estimated_fund_receive_date, creditlogs: stripe_fee_amount, stripe_fee_percent, platform_markup_amount, tenant_name, charge_type
-- Idempotent: runner ignores ER_DUP_FIELDNAME (1060) so re-run is safe.

ALTER TABLE stripepayout ADD COLUMN estimated_fund_receive_date date DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN stripe_fee_amount decimal(18,4) DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN stripe_fee_percent decimal(8,2) DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN platform_markup_amount decimal(18,4) DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN tenant_name varchar(255) DEFAULT NULL;
ALTER TABLE creditlogs ADD COLUMN charge_type varchar(50) DEFAULT NULL;
