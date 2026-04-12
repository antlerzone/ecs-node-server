-- stripe_operator_payouts: one row per Stripe payout.id per client
-- used for webhook-driven payout journal creation (idempotent by payout_id)

CREATE TABLE IF NOT EXISTS stripe_operator_payouts (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  payout_id varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  amount_cents bigint NOT NULL DEFAULT 0,
  arrival_date date DEFAULT NULL,
  raw_data json DEFAULT NULL,
  accounting_journal_id varchar(255) DEFAULT NULL,
  journal_created_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stripe_operator_payouts_client_payout (client_id, payout_id),
  KEY idx_stripe_operator_payouts_status (client_id, status, journal_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
