-- billplz_operator_payments: track Billplz tenant payment lifecycle
-- 1) payment success
-- 2) settlement considered received on successful payment (direct operator flow)
-- 3) payout to bank via payment_order callback

CREATE TABLE IF NOT EXISTS billplz_operator_payments (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  provider varchar(20) NOT NULL DEFAULT 'billplz',
  payment_id varchar(100) NOT NULL,
  bill_id varchar(100) DEFAULT NULL,
  charge_type varchar(50) NOT NULL DEFAULT 'rental',
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  gross_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  reference_number varchar(255) DEFAULT NULL,
  invoice_source varchar(50) DEFAULT NULL,
  invoice_record_id varchar(100) DEFAULT NULL,
  invoice_id varchar(100) DEFAULT NULL,

  payment_status varchar(20) NOT NULL DEFAULT 'pending',
  paid_at datetime DEFAULT NULL,

  settlement_status varchar(20) NOT NULL DEFAULT 'pending',
  estimated_receive_at datetime DEFAULT NULL,
  received_at datetime DEFAULT NULL,

  payout_status varchar(20) NOT NULL DEFAULT 'pending',
  payout_at datetime DEFAULT NULL,
  accounting_journal_id varchar(255) DEFAULT NULL,

  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_billplz_operator_payment_client_payment (client_id, payment_id),
  KEY idx_bop_client_status (client_id, payment_status, settlement_status, payout_status)
);
