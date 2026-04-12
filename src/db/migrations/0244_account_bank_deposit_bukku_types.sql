-- Align canonical GL templates with Bukku POST /accounts enum (0163).
-- Fixes sync matching when rows still have legacy `asset` / `liability` tokens.
-- Run: node scripts/run-migration.js src/db/migrations/0244_account_bank_deposit_bukku_types.sql

SET NAMES utf8mb4;

-- Canonical ids (0156 / 0157)
UPDATE account
SET type = 'current_assets', updated_at = NOW()
WHERE id = '1c7e41b6-9d57-4c03-8122-a76baad3b592';

UPDATE account
SET type = 'current_liabilities', updated_at = NOW()
WHERE id = '18ba3daf-7208-46fc-8e97-43f34e898401';

-- Any duplicate-title legacy row (should not exist post-0157)
UPDATE account
SET type = 'current_assets', updated_at = NOW()
WHERE TRIM(COALESCE(title, '')) = 'Bank'
  AND LOWER(TRIM(COALESCE(type, ''))) <> 'current_assets';

UPDATE account
SET type = 'current_liabilities', updated_at = NOW()
WHERE TRIM(COALESCE(title, '')) = 'Deposit'
  AND LOWER(TRIM(COALESCE(type, ''))) <> 'current_liabilities';

-- Cleanlemons chart (0189): Bank / Cash still seeded as `asset`
UPDATE cln_account
SET type = 'current_assets', updated_at = CURRENT_TIMESTAMP(3)
WHERE id IN (
  'e0c10001-0000-4000-8000-000000000001',
  'e0c10001-0000-4000-8000-000000000002'
)
   OR (TRIM(COALESCE(title, '')) IN ('Bank', 'Cash')
       AND LOWER(TRIM(COALESCE(type, ''))) IN ('asset', 'assets'));
