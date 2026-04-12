-- Operator chart: drop "Cost of Sales" template (merge into Referral Fees for existing FKs).
-- Remove legacy duplicate titles: Referral, Referal, Referal Fees — keep single canonical "Referral Fees".
-- Run: node scripts/run-migration.js src/db/migrations/0158_account_drop_cost_of_sales_merge_referral_titles.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @cos := 'e1b2c3d4-2005-4000-8000-000000000305';
SET @ref := 'e1b2c3d4-2006-4000-8000-000000000306';

-- --- Merge Cost of Sales → Referral Fees, then delete COS row ---
DELETE ac_dup FROM account_client ac_dup
INNER JOIN account_client ac_keep
  ON ac_keep.account_id = @ref AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system
WHERE ac_dup.account_id = @cos;

UPDATE rentalcollection SET type_id = @ref WHERE type_id = @cos;

UPDATE account_client SET account_id = @ref WHERE account_id = @cos;

DELETE FROM account WHERE id = @cos;

-- --- Legacy titles → canonical Referral Fees ---
DELETE ac_dup FROM account_client ac_dup
INNER JOIN account a ON a.id = ac_dup.account_id
INNER JOIN account_client ac_keep
  ON ac_keep.account_id = @ref AND ac_keep.client_id = ac_dup.client_id AND ac_keep.system = ac_dup.system
WHERE TRIM(a.title) IN ('Referral', 'Referal', 'Referal Fees') AND a.id <> @ref;

UPDATE rentalcollection r
INNER JOIN account a ON a.id = r.type_id
SET r.type_id = @ref
WHERE TRIM(a.title) IN ('Referral', 'Referal', 'Referal Fees') AND a.id <> @ref;

UPDATE account_client ac
INNER JOIN account a ON a.id = ac.account_id
SET ac.account_id = @ref
WHERE TRIM(a.title) IN ('Referral', 'Referal', 'Referal Fees') AND a.id <> @ref;

DELETE FROM account WHERE TRIM(title) IN ('Referral', 'Referal', 'Referal Fees') AND id <> @ref;
