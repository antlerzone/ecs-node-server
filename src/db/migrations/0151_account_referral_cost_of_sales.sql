-- Referral is cost of sales (not operating expenses). Aligns template + Bukku enum.
-- Run: node scripts/run-migration.js src/db/migrations/0151_account_referral_cost_of_sales.sql

UPDATE account
SET
  type = 'cost_of_sales',
  bukkuaccounttype = 'cost_of_sales',
  updated_at = NOW()
WHERE TRIM(title) = 'Referral';
