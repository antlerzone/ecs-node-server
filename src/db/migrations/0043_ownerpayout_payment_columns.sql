-- OwnerPayout: add management_fee, accounting_status, payment_date, payment_method, status, generated_at for report/payment flow.
-- Run once. If columns already exist, comment out or skip.

ALTER TABLE ownerpayout ADD COLUMN management_fee decimal(18,2) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN accounting_status varchar(50) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN payment_date date DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN payment_method varchar(100) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN status varchar(50) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN generated_at datetime DEFAULT NULL;
