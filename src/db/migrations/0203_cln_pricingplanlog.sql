-- Cleanlemons SaaS pricing / platform Bukku cash invoice audit log (Coliving pricingplanlogs analogue).
-- Subscription row `cln_operator_subscription` stays for plan/expiry only; invoice id/url live here.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cln_pricingplanlog (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  operator_id CHAR(36) NOT NULL,
  subscription_addon_id VARCHAR(64) DEFAULT NULL COMMENT 'set when log_kind = addon',
  log_kind VARCHAR(24) NOT NULL COMMENT 'subscription | addon',
  source VARCHAR(64) DEFAULT NULL COMMENT 'stripe_checkout | saas_admin_manual | saas_admin_addon | stripe_addon | migrate',
  scenario VARCHAR(64) DEFAULT NULL COMMENT 'subscribe | renew | upgrade | manual_accounting | …',
  plan_code VARCHAR(32) DEFAULT NULL,
  billing_cycle VARCHAR(16) DEFAULT NULL,
  addon_code VARCHAR(64) DEFAULT NULL,
  amount_myr DECIMAL(12,2) DEFAULT NULL,
  amount_total_cents INT DEFAULT NULL,
  stripe_session_id VARCHAR(128) DEFAULT NULL,
  invoice_id VARCHAR(100) DEFAULT NULL COMMENT 'platform SaaS Bukku sales invoice id',
  invoice_url VARCHAR(512) DEFAULT NULL,
  meta_json TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_cln_ppl_operator_kind_created (operator_id, log_kind, created_at),
  KEY idx_cln_ppl_addon (subscription_addon_id),
  KEY idx_cln_ppl_stripe_kind (stripe_session_id, log_kind),
  CONSTRAINT fk_cln_ppl_operatordetail
    FOREIGN KEY (operator_id) REFERENCES cln_operatordetail (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- subscription_addon_id references cln_operator_subscription_addon.id logically (table may be app-created only).
