-- Refund deposit: link to tenancy for cron "tenancy end, no renew" dedupe and display.
ALTER TABLE refunddeposit ADD COLUMN tenancy_id varchar(36) DEFAULT NULL AFTER client_id;
ALTER TABLE refunddeposit ADD KEY idx_refunddeposit_tenancy_id (tenancy_id);
ALTER TABLE refunddeposit ADD CONSTRAINT fk_refunddeposit_tenancy
  FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE SET NULL;
