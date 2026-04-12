-- Remove Owner Account (Payout) / Owner Payout template row from `account`.
-- Business table `ownerpayout` (monthly reports) is unchanged; only the chart template id is removed.
-- Imports: map Wix row id e053… → Platform Collection via account-canonical-map.js.
-- Run: node scripts/run-migration.js src/db/migrations/0248_drop_account_owner_payout_template.sql

SET NAMES utf8mb4;

UPDATE rentalcollection
SET type_id = 'a1b2c3d4-0003-4000-8000-000000000003'
WHERE type_id = 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';

DELETE FROM account_client WHERE account_id = 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';

DELETE FROM account WHERE id = 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3';
