-- Default account templates: tenant collections align with Platform Collection (liability / CURRENT_LIABILITY).
-- Management fees stay income (REVENUE). Operators map account_client → same Bukku GL as Platform Collection where needed.
-- Run: node scripts/run-migration.js src/db/migrations/0150_account_tenant_payments_platform_collection_liability.sql

-- Ensure a dedicated meter top-up row exists (Stripe cash invoice line item). Omit wix_id for DBs that dropped the column.
INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-1001-4000-8000-000000000101', 'Topup Aircond', 'liability', 'CURRENT_LIABILITY', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM account WHERE TRIM(title) IN ('Topup Aircond', 'Top-up Aircond', 'Meter Topup') LIMIT 1
);

UPDATE account
SET type = 'liability',
    bukkuaccounttype = 'CURRENT_LIABILITY',
    updated_at = NOW()
WHERE TRIM(title) IN (
  'Rent Income',
  'Rental Income',
  'Topup Aircond',
  'Top-up Aircond',
  'Meter Topup',
  'Parking',
  'Parking Fee',
  'Parking Fees',
  'Forfeit Deposit',
  'Maintenance Fees',
  'Maintenance Fee'
);

UPDATE account
SET type = 'income',
    bukkuaccounttype = 'REVENUE',
    updated_at = NOW()
WHERE TRIM(title) IN ('Management Fees', 'Management Fee');

UPDATE account
SET type = 'liability',
    bukkuaccounttype = 'CURRENT_LIABILITY',
    updated_at = NOW()
WHERE TRIM(title) IN ('Platform Collection', 'Deposit', 'Security Deposit', 'Security & Deposit');
