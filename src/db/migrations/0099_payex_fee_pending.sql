-- Xendit (Payex) processing fee: when operator credit insufficient at callback, hold here. Process after top-up (deduct + creditlog).

CREATE TABLE IF NOT EXISTS payex_fee_pending (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  external_id varchar(255) NOT NULL,
  amount_credits int NOT NULL DEFAULT 0,
  amount_cents int NOT NULL DEFAULT 0,
  platform_markup_cents int NOT NULL DEFAULT 0,
  xendit_fee_cents int NOT NULL DEFAULT 0,
  charge_type varchar(50) DEFAULT 'rental',
  tenant_name varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payex_fee_pending_client (client_id),
  CONSTRAINT fk_payex_fee_pending_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
