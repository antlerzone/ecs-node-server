-- Align operator `account` template flags with live chart (is_product, uses_platform_collection_gl, type).
-- Idempotent. Safe to re-run.
-- Run: node scripts/run-migration.js src/db/migrations/0245_account_operator_chart_flags.sql

SET NAMES utf8mb4;

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = 'e2b2c3d4-2008-4000-8000-000000000308';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'e1b2c3d4-2009-4000-8000-000000000309';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'e1b2c3d4-2008-4000-8000-000000000308';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'cost_of_sales', updated_at = NOW()
WHERE id = 'e1b2c3d4-2007-4000-8000-000000000307';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'cost_of_sales', updated_at = NOW()
WHERE id = 'e1b2c3d4-2006-4000-8000-000000000306';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = 'e1b2c3d4-2004-4000-8000-000000000304';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'e1b2c3d4-2003-4000-8000-000000000303';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'e1b2c3d4-2002-4000-8000-000000000302';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'current_liabilities', updated_at = NOW()
WHERE id = 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_assets', updated_at = NOW()
WHERE id = 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_assets', updated_at = NOW()
WHERE id = 'b1b2c3d4-3001-4000-8000-000000000401';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = 'ae94f899-7f34-4aba-b6ee-39b97496e2a3';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = 'a1b2c3d4-1001-4000-8000-000000000101';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_liabilities', updated_at = NOW()
WHERE id = 'a1b2c3d4-0003-4000-8000-000000000003';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'a1b2c3d4-0002-4000-8000-000000000002';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_assets', updated_at = NOW()
WHERE id = 'a1b2c3d4-0001-4000-8000-000000000001';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = '94b4e060-3999-4c76-8189-f969615c0a7d';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = '86da59c0-992c-4e40-8efd-9d6d793eaf6a';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_assets', updated_at = NOW()
WHERE id = '26a35506-0631-4d79-9b4f-a8195b69c8ed';

UPDATE account SET is_product = 1, uses_platform_collection_gl = 1, type = NULL, updated_at = NOW()
WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_assets', updated_at = NOW()
WHERE id = '1c7e41b6-9d57-4c03-8122-a76baad3b592';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'current_liabilities', updated_at = NOW()
WHERE id = '18ba3daf-7208-46fc-8e97-43f34e898401';
