ALTER TABLE refunddeposit
  ADD COLUMN accounting_provider varchar(32) DEFAULT NULL AFTER status,
  ADD COLUMN accounting_ref_id varchar(128) DEFAULT NULL AFTER accounting_provider,
  ADD COLUMN accounting_ref_url text DEFAULT NULL AFTER accounting_ref_id;
