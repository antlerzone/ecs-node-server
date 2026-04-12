ALTER TABLE refunddeposit
  ADD COLUMN forfeit_accounting_provider varchar(32) DEFAULT NULL AFTER accounting_ref_url,
  ADD COLUMN forfeit_accounting_ref_id varchar(128) DEFAULT NULL AFTER forfeit_accounting_provider,
  ADD COLUMN forfeit_accounting_ref_url text DEFAULT NULL AFTER forfeit_accounting_ref_id;
