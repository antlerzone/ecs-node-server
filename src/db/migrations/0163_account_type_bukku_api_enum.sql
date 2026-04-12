-- Align `account.type` with Bukku POST /accounts `type` enum (snake_case):
-- current_assets, non_current_assets, other_assets,
-- current_liabilities, non_current_liabilities, equity,
-- income, other_income, cost_of_sales, expenses, taxation

-- Canonical operator chart (18 rows) — explicit ids
UPDATE account SET type = 'current_assets', updated_at = NOW()
  WHERE id IN (
    '1c7e41b6-9d57-4c03-8122-a76baad3b592',
    'a1b2c3d4-0001-4000-8000-000000000001',
    '26a35506-0631-4d79-9b4f-a8195b69c8ed',
    'd553cdbe-bc6b-46c2-aba8-f71aceedaf10'
  );

UPDATE account SET type = 'current_liabilities', updated_at = NOW()
  WHERE id IN (
    '18ba3daf-7208-46fc-8e97-43f34e898401',
    'a1b2c3d4-0003-4000-8000-000000000003'
  );

UPDATE account SET type = 'income', updated_at = NOW()
  WHERE id IN (
    'a1b2c3d4-0002-4000-8000-000000000002',
    '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
    'e1b2c3d4-2002-4000-8000-000000000302',
    'e1b2c3d4-2003-4000-8000-000000000303',
    'a1b2c3d4-1001-4000-8000-000000000101',
    '2020b22b-028e-4216-906c-c816dcb33a85',
    'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
    'e1b2c3d4-2004-4000-8000-000000000304',
    '94b4e060-3999-4c76-8189-f969615c0a7d'
  );

UPDATE account SET type = 'cost_of_sales', updated_at = NOW()
  WHERE id IN (
    'e1b2c3d4-2006-4000-8000-000000000306',
    'e1b2c3d4-2007-4000-8000-000000000307'
  );

UPDATE account SET type = 'expenses', updated_at = NOW()
  WHERE id = 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';

-- Legacy tokens (any remaining rows)
UPDATE account SET type = 'current_assets', updated_at = NOW()
  WHERE type IN ('BANK', 'bank', 'CURRENT_ASSET', 'current_asset', 'asset', 'assets');

UPDATE account SET type = 'current_liabilities', updated_at = NOW()
  WHERE type IN ('CURRENT_LIABILITY', 'current_liability', 'currliab', 'liability', 'liabilities');

UPDATE account SET type = 'income', updated_at = NOW()
  WHERE type IN ('REVENUE', 'revenue');

UPDATE account SET type = 'expenses', updated_at = NOW()
  WHERE type IN ('EXPENSE', 'expense') AND id <> 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';
