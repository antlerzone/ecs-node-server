-- Rent payments held when operator credit insufficient. After operator top-up, we deduct and release (transfer to Connect).
-- One row per held payment: release is tried after addClientCredit (top-up) and on manual POST /api/stripe/release-rent.

CREATE TABLE IF NOT EXISTS stripe_rent_pending_release (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  payment_intent_id varchar(255) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stripe_rent_pending_release_pi (payment_intent_id),
  KEY idx_stripe_rent_pending_release_client (client_id),
  CONSTRAINT fk_stripe_rent_pending_release_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
