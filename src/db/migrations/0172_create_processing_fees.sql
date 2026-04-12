-- Unified processing fee ledger for Stripe + Xendit, used by SaaS Admin processing-fees tab.
-- Amount columns are in major currency units (e.g. MYR/SGD), not cents.

CREATE TABLE IF NOT EXISTS processing_fees (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  provider varchar(20) NOT NULL,
  charge_type varchar(50) NOT NULL DEFAULT 'invoice',
  status varchar(20) NOT NULL DEFAULT 'settlement',
  payment_id varchar(100) NOT NULL,
  reference_number varchar(255) DEFAULT NULL,
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  gross_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  gateway_fee_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  platform_markup_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  total_fee_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  metadata_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_processing_fees_provider_payment_status (provider, payment_id, status),
  KEY idx_processing_fees_client_created (client_id, created_at),
  KEY idx_processing_fees_provider_created (provider, created_at),
  KEY idx_processing_fees_status_created (status, created_at),
  CONSTRAINT fk_processing_fees_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

