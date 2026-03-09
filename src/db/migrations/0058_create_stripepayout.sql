-- stripepayout: one row per client per calendar day for Connect payouts (no duplicates).
-- Used to sync to account system. When we Transfer to client, we add/update this day's row.

CREATE TABLE IF NOT EXISTS stripepayout (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  payout_date date NOT NULL,
  total_amount_cents bigint NOT NULL DEFAULT 0,
  currency varchar(10) DEFAULT NULL,
  transfer_ids json DEFAULT NULL,
  stripe_connect_payout_id varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stripepayout_client_date (client_id, payout_date),
  KEY idx_stripepayout_client_id (client_id),
  KEY idx_stripepayout_payout_date (payout_date),
  CONSTRAINT fk_stripepayout_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
