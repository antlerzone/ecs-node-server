-- Seed "Processing Fee" account template for Xendit settlement journal (DR Bank, DR Processing fees, CR Xendit).
-- Run when account table has no row with title 'Processing Fee'. Operator maps this to their accounting system in Accounting settings.

INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT UUID(), UUID(), 'Processing Fee', 'expenses', 'EXPENSE', NULL, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) = 'Processing Fee' LIMIT 1);
