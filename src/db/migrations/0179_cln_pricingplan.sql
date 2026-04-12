-- Cleanlemons operator subscription catalog (Stripe-backed). Not coliving `pricingplan`.
CREATE TABLE IF NOT EXISTS cln_pricingplan (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  plan_code VARCHAR(32) NOT NULL COMMENT 'starter|growth|enterprise',
  package_title VARCHAR(255) NOT NULL DEFAULT '',
  stripe_product_id VARCHAR(64) NOT NULL DEFAULT '',
  stripe_price_id VARCHAR(64) NOT NULL,
  amount_myr DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Total billed for this interval in MYR',
  currency VARCHAR(8) NOT NULL DEFAULT 'myr',
  interval_code VARCHAR(16) NOT NULL COMMENT 'month|quarter|year',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cln_pricingplan_price (stripe_price_id),
  KEY idx_cln_pricingplan_plan_interval (plan_code, interval_code, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cln_pricingplan (id, plan_code, package_title, stripe_product_id, stripe_price_id, amount_myr, currency, interval_code, sort_order) VALUES
('cln-pp-starter-month', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1LMdYG5m1R', 600.00, 'myr', 'month', 10),
('cln-pp-starter-quarter', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1L9mvB8o2e', 1710.00, 'myr', 'quarter', 11),
('cln-pp-starter-year', 'starter', 'Starter Package', 'prod_UE3KNXl7DCwB8g', 'price_1TFbDQJw29Db2I1LFPYlFt8B', 5760.00, 'myr', 'year', 12),
('cln-pp-growth-month', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LxpMDPmXP', 1200.00, 'myr', 'month', 20),
('cln-pp-growth-quarter', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LxHk2FJwI', 3420.00, 'myr', 'quarter', 21),
('cln-pp-growth-year', 'growth', 'Growth Package', 'prod_UE3LajqM7qPuPo', 'price_1TFbEQJw29Db2I1LptV8JYlc', 11520.00, 'myr', 'year', 22),
('cln-pp-enterprise-month', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LZrJPYcCu', 1800.00, 'myr', 'month', 30),
('cln-pp-enterprise-quarter', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LNxiGieLJ', 5130.00, 'myr', 'quarter', 31),
('cln-pp-enterprise-year', 'enterprise', 'Enterprise Package', 'prod_UE3NaGai1m5BFK', 'price_1TFbGJJw29Db2I1LTWFAFngZ', 17280.00, 'myr', 'year', 32)
ON DUPLICATE KEY UPDATE
  package_title = VALUES(package_title),
  stripe_product_id = VALUES(stripe_product_id),
  amount_myr = VALUES(amount_myr),
  currency = VALUES(currency),
  interval_code = VALUES(interval_code),
  sort_order = VALUES(sort_order),
  is_active = 1;
