-- Store Bukku cash-invoice line text (form_items[].description) on pricing plan log;
-- dedicated add-on audit table (purchase / future lifecycle events).
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has_ppl := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_pricingplanlog'
);

SET @sql := IF(
  @has_ppl > 0
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_pricingplanlog'
           AND COLUMN_NAME = 'form_item_description') = 0,
  'ALTER TABLE cln_pricingplanlog ADD COLUMN form_item_description VARCHAR(512) DEFAULT NULL COMMENT ''Bukku form_items[0].description'' AFTER invoice_url',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS cln_addonlog (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  operator_id CHAR(36) NOT NULL,
  subscription_addon_id VARCHAR(64) DEFAULT NULL COMMENT 'cln_operator_subscription_addon.id',
  event_kind VARCHAR(32) NOT NULL COMMENT 'purchase_stripe | purchase_admin | terminate | …',
  addon_code VARCHAR(64) DEFAULT NULL,
  addon_name VARCHAR(255) DEFAULT NULL,
  amount_myr DECIMAL(12,2) DEFAULT NULL,
  stripe_session_id VARCHAR(128) DEFAULT NULL,
  pricingplanlog_id VARCHAR(64) DEFAULT NULL COMMENT 'cln_pricingplanlog.id when invoice logged',
  invoice_id VARCHAR(100) DEFAULT NULL,
  invoice_url VARCHAR(512) DEFAULT NULL,
  form_item_description VARCHAR(512) DEFAULT NULL,
  meta_json TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_cln_al_operator_created (operator_id, created_at),
  KEY idx_cln_al_addon_row (subscription_addon_id),
  KEY idx_cln_al_ppl (pricingplanlog_id),
  CONSTRAINT fk_cln_al_operatordetail
    FOREIGN KEY (operator_id) REFERENCES cln_operatordetail (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
