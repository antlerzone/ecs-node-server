-- Remove Maintainance Fees template row (e2b2c3d4-2008…). Repoint FKs to Other (94b4e060…).
-- Idempotent: DELETE/UPDATE only affect rows that still reference the old id.
-- Run: node scripts/run-migration.js src/db/migrations/0247_drop_account_maintainance_fees_template.sql

SET NAMES utf8mb4;

-- Literal UUIDs avoid user-variable collation mismatches across MySQL versions.
UPDATE rentalcollection
SET type_id = '94b4e060-3999-4c76-8189-f969615c0a7d'
WHERE type_id = 'e2b2c3d4-2008-4000-8000-000000000308';

DELETE FROM account_client WHERE account_id = 'e2b2c3d4-2008-4000-8000-000000000308';

DELETE FROM account WHERE id = 'e2b2c3d4-2008-4000-8000-000000000308';
