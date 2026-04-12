-- Seed "Referral" account template for commission release (money out to staff). Cost of sales in chart of accounts.
INSERT INTO account (id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT UUID(), 'Referral', 'cost_of_sales', 'cost_of_sales', NULL, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) = 'Referral' LIMIT 1);
