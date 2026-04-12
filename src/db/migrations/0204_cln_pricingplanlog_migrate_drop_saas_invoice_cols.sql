-- Move legacy saas_bukku_invoice_* from subscription/addon rows into cln_pricingplanlog, then drop those columns.
-- Requires 0202 (columns exist) and 0203 (cln_pricingplanlog exists). Safe to skip inserts when no legacy data.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

SET @has_log := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_pricingplanlog'
);

SET @has_sub_col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_subscription' AND column_name = 'saas_bukku_invoice_id'
);

SET @has_addon_col := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_operator_subscription_addon' AND column_name = 'saas_bukku_invoice_id'
);

-- Migrate subscription-level invoice refs into log
SET @sql := IF(
  @has_log > 0 AND @has_sub_col > 0,
  'INSERT INTO cln_pricingplanlog (id, operator_id, subscription_addon_id, log_kind, source, scenario, plan_code, billing_cycle, invoice_id, invoice_url, created_at, updated_at)
   SELECT CONCAT(\'cln-ppl-mig-\', UUID()), s.operator_id, NULL, \'subscription\', \'migrate\', NULL, s.plan_code, s.billing_cycle,
          NULLIF(TRIM(s.saas_bukku_invoice_id), \'\'), NULLIF(TRIM(s.saas_bukku_invoice_url), \'\'), NOW(3), NOW(3)
   FROM cln_operator_subscription s
   WHERE (s.saas_bukku_invoice_id IS NOT NULL AND TRIM(s.saas_bukku_invoice_id) <> \'\')
      OR (s.saas_bukku_invoice_url IS NOT NULL AND TRIM(s.saas_bukku_invoice_url) <> \'\')',
  'SELECT 1'
);
PREPARE s1 FROM @sql;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- Migrate addon-level invoice refs
SET @sql := IF(
  @has_log > 0 AND @has_addon_col > 0,
  'INSERT INTO cln_pricingplanlog (id, operator_id, subscription_addon_id, log_kind, source, scenario, plan_code, billing_cycle, addon_code, invoice_id, invoice_url, created_at, updated_at)
   SELECT CONCAT(\'cln-ppl-mig-\', UUID()), a.operator_id, a.id, \'addon\', \'migrate\', NULL, NULL, NULL, a.addon_code,
          NULLIF(TRIM(a.saas_bukku_invoice_id), \'\'), NULLIF(TRIM(a.saas_bukku_invoice_url), \'\'), NOW(3), NOW(3)
   FROM cln_operator_subscription_addon a
   WHERE (a.saas_bukku_invoice_id IS NOT NULL AND TRIM(a.saas_bukku_invoice_id) <> \'\')
      OR (a.saas_bukku_invoice_url IS NOT NULL AND TRIM(a.saas_bukku_invoice_url) <> \'\')',
  'SELECT 1'
);
PREPARE s2 FROM @sql;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- Drop legacy columns on subscription
SET @sql := IF(
  @has_sub_col > 0,
  'ALTER TABLE cln_operator_subscription DROP COLUMN saas_bukku_invoice_id, DROP COLUMN saas_bukku_invoice_url',
  'SELECT 1'
);
PREPARE s3 FROM @sql;
EXECUTE s3;
DEALLOCATE PREPARE s3;

-- Drop legacy columns on addon
SET @sql := IF(
  @has_addon_col > 0,
  'ALTER TABLE cln_operator_subscription_addon DROP COLUMN saas_bukku_invoice_id, DROP COLUMN saas_bukku_invoice_url',
  'SELECT 1'
);
PREPARE s4 FROM @sql;
EXECUTE s4;
DEALLOCATE PREPARE s4;
