-- Canonical operator default chart: only the templates agreed for portal Accounting.
-- Assets: Bank, Cash, Stripe, Xendit | Liabilities: Deposit, Platform Collection
-- Income (revenue lines + tenant charge types): Management Fees, Owner Commission, Tenant Commission,
--   Agreement Fees, Topup Aircond, Forfeit Deposit, Rental Income, Parking Fees, Other
-- Removes placeholder rows Account 7–13, Current Assets, and unreferenced Processing Fee / Referral seeds.
-- Run: node scripts/run-migration.js src/db/migrations/0154_account_template_canonical_operator_chart.sql
--
-- Notes:
-- * id = Wix-era UUIDs where already fixed; new rows use deterministic ids e1b2c3d4-20xx-…
-- * Row 86da59c0 was seeded as "Expenses" but code used it as Owner Commission — retitle + retype here.
-- * "Stripe Current Assets" / "Payex Current Assets" renamed to "Stripe" / "Xendit" (payment helpers already match short names).

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- --- Renames / corrections on existing fixed ids ---
UPDATE account
SET title = 'Stripe', type = 'asset', bukkuaccounttype = 'CURRENT_ASSET', updated_at = NOW()
WHERE id = '26a35506-0631-4d79-9b4f-a8195b69c8ed';

UPDATE account
SET title = 'Xendit', type = 'asset', bukkuaccounttype = 'CURRENT_ASSET', updated_at = NOW()
WHERE id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';

UPDATE account
SET title = 'Rental Income', type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';

UPDATE account
SET title = 'Owner Commission', type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a';

UPDATE account
SET title = 'Other', type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE id = '94b4e060-3999-4c76-8189-f969615c0a7d';

UPDATE account
SET type = 'liability', bukkuaccounttype = 'CURRENT_LIABILITY', updated_at = NOW()
WHERE id = '18ba3daf-7208-46fc-8e97-43f34e898401';

UPDATE account
SET type = 'liability', bukkuaccounttype = 'CURRENT_LIABILITY', updated_at = NOW()
WHERE id = 'a1b2c3d4-0003-4000-8000-000000000003';

UPDATE account
SET type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE id = 'a1b2c3d4-0002-4000-8000-000000000002';

-- Topup Aircond: single template row (0150); align to income/revenue (only Deposit + Platform stay liability).
UPDATE account
SET title = 'Topup Aircond', type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE id = 'a1b2c3d4-1001-4000-8000-000000000101';

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-1001-4000-8000-000000000101', 'Topup Aircond', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'a1b2c3d4-1001-4000-8000-000000000101')
  AND NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) IN ('Topup Aircond', 'Top-up Aircond', 'Meter Topup') LIMIT 1);

UPDATE account
SET title = 'Parking Fees', type = 'income', bukkuaccounttype = 'REVENUE', updated_at = NOW()
WHERE TRIM(title) IN ('Parking', 'Parking Fee') AND TRIM(title) <> 'Parking Fees';

-- --- Insert missing templates (deterministic ids) ---
INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2002-4000-8000-000000000302', 'Tenant Commission', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2002-4000-8000-000000000302' OR TRIM(title) = 'Tenant Commission' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2003-4000-8000-000000000303', 'Agreement Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2003-4000-8000-000000000303' OR TRIM(title) = 'Agreement Fees' LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2004-4000-8000-000000000304', 'Parking Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = 'e1b2c3d4-2004-4000-8000-000000000304' OR TRIM(title) IN ('Parking Fees', 'Parking Fee', 'Parking') LIMIT 1);

INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT '2020b22b-028e-4216-906c-c816dcb33a85', 'Forfeit Deposit', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM account WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85' OR TRIM(title) = 'Forfeit Deposit' LIMIT 1);

-- --- Remove placeholders only when nothing points at them ---
DELETE FROM account
WHERE id IN (
  'bf502145-6ec8-45bd-a703-13c810cfe186',
  'cf4141b1-c24e-4fc1-930e-cfea4329b178',
  'e4fd92bb-de15-4ca0-9c6b-05e410815c58',
  'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00',
  '620b2d43-4b3a-448f-8a5b-99eb2c3209c7',
  'd3f72d51-c791-4ef0-aeec-3ed1134e5c86',
  '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
  'e053b254-5a3c-4b82-8ba0-fd6d0df231d3'
)
AND NOT EXISTS (SELECT 1 FROM rentalcollection WHERE type_id = account.id)
AND NOT EXISTS (SELECT 1 FROM account_client WHERE account_id = account.id);

DELETE FROM account
WHERE TRIM(title) IN ('Processing Fee', 'Referral')
  AND NOT EXISTS (SELECT 1 FROM rentalcollection WHERE type_id = account.id)
  AND NOT EXISTS (SELECT 1 FROM account_client WHERE account_id = account.id);
