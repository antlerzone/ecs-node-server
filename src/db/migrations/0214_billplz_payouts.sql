-- billplz_payouts: one row per Billplz payment_order_id per client
-- used for webhook-driven payout journal creation (idempotent by payment_order_id)

CREATE TABLE IF NOT EXISTS billplz_payouts (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  payment_order_id varchar(100) NOT NULL,
  reference_id varchar(100) DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  amount decimal(14,2) NOT NULL DEFAULT 0.00,
  payout_date date DEFAULT NULL,
  raw_data json DEFAULT NULL,
  accounting_journal_id varchar(255) DEFAULT NULL,
  journal_created_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_billplz_payouts_client_payment_order (client_id, payment_order_id),
  KEY idx_billplz_payouts_status (client_id, status, journal_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
