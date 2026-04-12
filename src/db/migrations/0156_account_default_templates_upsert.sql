-- Default accounting templates (Operator Accounting list): insert each canonical row only when
-- no row exists with that `id` AND no row exists with the same trimmed `title`.
-- (Replaces bulk INSERT .. ON DUPLICATE KEY UPDATE on `id` only, which could insert a second row
-- when an older import already had the same title with a different UUID — e.g. two "Forfeit Deposit".)
-- Does not delete rows. Run: node scripts/run-migration.js src/db/migrations/0156_account_default_templates_upsert.sql
--
-- Asset (4) | Liability (2) | Income/product lines (9) | Cost of sales (1) | Expenses (1) = 17 rows (no separate "Cost of Sales" row)

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '1c7e41b6-9d57-4c03-8122-a76baad3b592', 'Bank', 'asset', 'BANK', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '1c7e41b6-9d57-4c03-8122-a76baad3b592' OR TRIM(COALESCE(title,'')) = 'Bank' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0001-4000-8000-000000000001', 'Cash', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'a1b2c3d4-0001-4000-8000-000000000001' OR TRIM(COALESCE(title,'')) = 'Cash' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '26a35506-0631-4d79-9b4f-a8195b69c8ed', 'Stripe', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '26a35506-0631-4d79-9b4f-a8195b69c8ed' OR TRIM(COALESCE(title,'')) = 'Stripe' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10', 'Xendit', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10' OR TRIM(COALESCE(title,'')) = 'Xendit' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '18ba3daf-7208-46fc-8e97-43f34e898401', 'Deposit', 'liability', 'CURRENT_LIABILITY', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '18ba3daf-7208-46fc-8e97-43f34e898401' OR TRIM(COALESCE(title,'')) = 'Deposit' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0003-4000-8000-000000000003', 'Platform Collection', 'liability', 'CURRENT_LIABILITY', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'a1b2c3d4-0003-4000-8000-000000000003' OR TRIM(COALESCE(title,'')) = 'Platform Collection' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0002-4000-8000-000000000002', 'Management Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'a1b2c3d4-0002-4000-8000-000000000002' OR TRIM(COALESCE(title,'')) = 'Management Fees' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '86da59c0-992c-4e40-8efd-9d6d793eaf6a', 'Owner Commission', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' OR TRIM(COALESCE(title,'')) = 'Owner Commission' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2002-4000-8000-000000000302', 'Tenant Commission', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2002-4000-8000-000000000302' OR TRIM(COALESCE(title,'')) = 'Tenant Commission' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2003-4000-8000-000000000303', 'Agreement Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2003-4000-8000-000000000303' OR TRIM(COALESCE(title,'')) = 'Agreement Fees' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-1001-4000-8000-000000000101', 'Topup Aircond', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'a1b2c3d4-1001-4000-8000-000000000101' OR TRIM(COALESCE(title,'')) = 'Topup Aircond' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '2020b22b-028e-4216-906c-c816dcb33a85', 'Forfeit Deposit', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85' OR TRIM(COALESCE(title,'')) = 'Forfeit Deposit' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'ae94f899-7f34-4aba-b6ee-39b97496e2a3', 'Rental Income', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3' OR TRIM(COALESCE(title,'')) = 'Rental Income' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2004-4000-8000-000000000304', 'Parking Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2004-4000-8000-000000000304' OR TRIM(COALESCE(title,'')) = 'Parking Fees' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '94b4e060-3999-4c76-8189-f969615c0a7d', 'Other', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '94b4e060-3999-4c76-8189-f969615c0a7d' OR TRIM(COALESCE(title,'')) = 'Other' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2006-4000-8000-000000000306', 'Referral Fees', 'cost_of_sales', 'cost_of_sales', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2006-4000-8000-000000000306' OR TRIM(COALESCE(title,'')) = 'Referral Fees' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2007-4000-8000-000000000307', 'Processing Fees', 'expenses', 'EXPENSE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2007-4000-8000-000000000307' OR TRIM(COALESCE(title,'')) = 'Processing Fees' LIMIT 1);
