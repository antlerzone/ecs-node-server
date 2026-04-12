-- Cleanlemons subscription add-on catalog (annual list prices in MYR).
CREATE TABLE IF NOT EXISTS cln_addon (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  addon_code VARCHAR(64) NOT NULL COMMENT 'matches cln_operator_subscription_addon.addon_code e.g. bulk-transfer',
  title VARCHAR(255) NOT NULL DEFAULT '',
  description VARCHAR(512) NULL,
  amount_myr DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Price for interval_code (typically full year)',
  currency VARCHAR(8) NOT NULL DEFAULT 'myr',
  interval_code VARCHAR(16) NOT NULL DEFAULT 'year' COMMENT 'year',
  stripe_price_id VARCHAR(64) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cln_addon_code (addon_code),
  KEY idx_cln_addon_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cln_addon (id, addon_code, title, description, amount_myr, currency, interval_code, stripe_price_id, sort_order) VALUES
('cln-addon-bulk-transfer', 'bulk-transfer', 'Bulk transfer', 'Bank bulk salary transfer and related workflows.', 2400.00, 'myr', 'year', '', 10),
('cln-addon-api-integration', 'api-integration', 'API Integration', 'Programmatic access for integrations and automation.', 2400.00, 'myr', 'year', '', 20)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  amount_myr = VALUES(amount_myr),
  interval_code = VALUES(interval_code),
  sort_order = VALUES(sort_order),
  is_active = 1;
