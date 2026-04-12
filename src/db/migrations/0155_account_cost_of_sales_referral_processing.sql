-- Add canonical templates: Cost of Sales, Referral Fees (COS), Processing Fees (expense).
-- Run after 0154. Fixed ids for operator Accounting + settlement / commission flows.
-- Run: node scripts/run-migration.js src/db/migrations/0155_account_cost_of_sales_referral_processing.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2005-4000-8000-000000000305', 'Cost of Sales', 'cost_of_sales', 'cost_of_sales', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2005-4000-8000-000000000305');

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2006-4000-8000-000000000306', 'Referral Fees', 'cost_of_sales', 'cost_of_sales', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2006-4000-8000-000000000306');

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2007-4000-8000-000000000307', 'Processing Fees', 'expenses', 'EXPENSE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2007-4000-8000-000000000307');
