-- Referral: Bukku API expects type = expenses (not EXPENSE). Remove typo duplicate templates when canonical Referral exists.
-- Run: node scripts/run-migration.js src/db/migrations/0144_account_referral_bukku_type_and_dedupe.sql

UPDATE account
SET bukkuaccounttype = 'expenses', updated_at = NOW()
WHERE TRIM(title) = 'Referral'
  AND (UPPER(TRIM(bukkuaccounttype)) = 'EXPENSE' OR TRIM(bukkuaccounttype) = '');

DELETE FROM account_client
WHERE account_id IN (SELECT id FROM (SELECT id FROM account WHERE TRIM(title) = 'Referal') t);

DELETE FROM account
WHERE TRIM(title) = 'Referal';

DELETE ac FROM account_client ac
INNER JOIN account a ON a.id = ac.account_id
CROSS JOIN (SELECT id FROM account WHERE TRIM(title) = 'Referral' LIMIT 1) r
WHERE TRIM(a.title) = 'Referal Fees';

DELETE a FROM account a
CROSS JOIN (SELECT id FROM account WHERE TRIM(title) = 'Referral' LIMIT 1) r
WHERE TRIM(a.title) = 'Referal Fees';
