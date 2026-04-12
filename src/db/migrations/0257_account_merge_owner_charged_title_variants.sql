-- Merge Bukku/Wix-style duplicate account rows into canonical template ids:
-- * Owner Comission / (owner) / "2" variants → Owner Commission (86da59c0-…)
-- * Management Fees (owner) → Management Fees (a1b2c3d4-0002-…)
-- Repoints rentalcollection.type_id + account_client.account_id; deletes extras.
-- Safe to run multiple times.
-- Run: node scripts/run-migration.js src/db/migrations/0257_account_merge_owner_charged_title_variants.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Owner Commission variants → canonical 86da59c0-992c-4e40-8efd-9d6d793eaf6a
DELETE ac_dup FROM account_client ac_dup
INNER JOIN account a ON a.id = ac_dup.account_id
INNER JOIN account_client ac_keep ON ac_keep.account_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system
WHERE a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND (
  TRIM(a.title) IN ('Owner Comission', 'Owner Comission 2', 'Owner Comission (owner)', 'Owner Commission (owner)', 'owner comission (owner)')
  OR LOWER(TRIM(a.title)) IN ('owner comission (owner)', 'owner commission (owner)')
);

UPDATE rentalcollection r
INNER JOIN account a ON a.id = r.type_id
SET r.type_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a'
WHERE a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND (
  TRIM(a.title) IN ('Owner Comission', 'Owner Comission 2', 'Owner Comission (owner)', 'Owner Commission (owner)', 'owner comission (owner)')
  OR LOWER(TRIM(a.title)) IN ('owner comission (owner)', 'owner commission (owner)')
);

UPDATE account_client ac
INNER JOIN account a ON a.id = ac.account_id
SET ac.account_id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a'
WHERE a.id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND (
  TRIM(a.title) IN ('Owner Comission', 'Owner Comission 2', 'Owner Comission (owner)', 'Owner Commission (owner)', 'owner comission (owner)')
  OR LOWER(TRIM(a.title)) IN ('owner comission (owner)', 'owner commission (owner)')
);

DELETE FROM account WHERE id <> '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND (
  TRIM(title) IN ('Owner Comission', 'Owner Comission 2', 'Owner Comission (owner)', 'Owner Commission (owner)', 'owner comission (owner)')
  OR LOWER(TRIM(title)) IN ('owner comission (owner)', 'owner commission (owner)')
);

-- Management Fees (owner) → canonical a1b2c3d4-0002-4000-8000-000000000002
DELETE ac_dup FROM account_client ac_dup
INNER JOIN account a ON a.id = ac_dup.account_id
INNER JOIN account_client ac_keep ON ac_keep.account_id = 'a1b2c3d4-0002-4000-8000-000000000002' AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system
WHERE a.id <> 'a1b2c3d4-0002-4000-8000-000000000002' AND (
  TRIM(a.title) IN ('Management Fees (owner)', 'Management Fee (owner)', 'management fees (owner)')
  OR LOWER(TRIM(a.title)) IN ('management fees (owner)', 'management fee (owner)')
);

UPDATE rentalcollection r
INNER JOIN account a ON a.id = r.type_id
SET r.type_id = 'a1b2c3d4-0002-4000-8000-000000000002'
WHERE a.id <> 'a1b2c3d4-0002-4000-8000-000000000002' AND (
  TRIM(a.title) IN ('Management Fees (owner)', 'Management Fee (owner)', 'management fees (owner)')
  OR LOWER(TRIM(a.title)) IN ('management fees (owner)', 'management fee (owner)')
);

UPDATE account_client ac
INNER JOIN account a ON a.id = ac.account_id
SET ac.account_id = 'a1b2c3d4-0002-4000-8000-000000000002'
WHERE a.id <> 'a1b2c3d4-0002-4000-8000-000000000002' AND (
  TRIM(a.title) IN ('Management Fees (owner)', 'Management Fee (owner)', 'management fees (owner)')
  OR LOWER(TRIM(a.title)) IN ('management fees (owner)', 'management fee (owner)')
);

DELETE FROM account WHERE id <> 'a1b2c3d4-0002-4000-8000-000000000002' AND (
  TRIM(title) IN ('Management Fees (owner)', 'Management Fee (owner)', 'management fees (owner)')
  OR LOWER(TRIM(title)) IN ('management fees (owner)', 'management fee (owner)')
);

-- Ensure canonical template titles (no suffix / typo)
UPDATE account SET title = 'Owner Commission' WHERE id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a' AND TRIM(title) <> 'Owner Commission';
UPDATE account SET title = 'Management Fees' WHERE id = 'a1b2c3d4-0002-4000-8000-000000000002' AND TRIM(title) <> 'Management Fees';
