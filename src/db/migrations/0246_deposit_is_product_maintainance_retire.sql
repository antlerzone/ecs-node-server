-- Deposit: is_product = 1 (Bukku product line for deposit charges).
-- Maintainance Fees: no longer product + Platform Collection GL; not offered as tenant invoice type (see tenantinvoice getTypes + accountLineMappingRules).
-- Idempotent. Safe to re-run.
-- Run: node scripts/run-migration.js src/db/migrations/0246_deposit_is_product_maintainance_retire.sql

SET NAMES utf8mb4;

UPDATE account SET is_product = 1, updated_at = NOW()
WHERE id = '18ba3daf-7208-46fc-8e97-43f34e898401';

UPDATE account SET is_product = 0, uses_platform_collection_gl = 0, type = 'income', updated_at = NOW()
WHERE id = 'e2b2c3d4-2008-4000-8000-000000000308';
