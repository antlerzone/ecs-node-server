-- Seed default account templates (bukkuid) so Account Setting page has items.
-- Only run when account table is empty. Uses same wix_id as frontend PROTECTED_BUKKUID_IDS.
-- Run: mysql ... < 0046_seed_account_defaults.sql  OR  node scripts/run-migration.js src/db/migrations/0046_seed_account_defaults.sql

INSERT IGNORE INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at) VALUES
('bf502145-6ec8-45bd-a703-13c810cfe186', 'bf502145-6ec8-45bd-a703-13c810cfe186', 'Current Assets', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('1c7e41b6-9d57-4c03-8122-a76baad3b592', '1c7e41b6-9d57-4c03-8122-a76baad3b592', 'Bank', 'asset', 'BANK', NULL, NOW(), NOW()),
('ae94f899-7f34-4aba-b6ee-39b97496e2a3', 'ae94f899-7f34-4aba-b6ee-39b97496e2a3', 'Rent Income', 'income', 'REVENUE', NULL, NOW(), NOW()),
('18ba3daf-7208-46fc-8e97-43f34e898401', '18ba3daf-7208-46fc-8e97-43f34e898401', 'Deposit', 'liability', 'CURRENT_LIABILITY', NULL, NOW(), NOW()),
('86da59c0-992c-4e40-8efd-9d6d793eaf6a', '86da59c0-992c-4e40-8efd-9d6d793eaf6a', 'Expenses', 'expenses', 'EXPENSE', NULL, NOW(), NOW()),
('94b4e060-3999-4c76-8189-f969615c0a7d', '94b4e060-3999-4c76-8189-f969615c0a7d', 'Product / Service', 'product', 'REVENUE', NULL, NOW(), NOW()),
('cf4141b1-c24e-4fc1-930e-cfea4329b178', 'cf4141b1-c24e-4fc1-930e-cfea4329b178', 'Account 7', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('e4fd92bb-de15-4ca0-9c6b-05e410815c58', 'e4fd92bb-de15-4ca0-9c6b-05e410815c58', 'Account 8', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00', 'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00', 'Account 9', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('620b2d43-4b3a-448f-8a5b-99eb2c3209c7', '620b2d43-4b3a-448f-8a5b-99eb2c3209c7', 'Account 10', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('d3f72d51-c791-4ef0-aeec-3ed1134e5c86', 'd3f72d51-c791-4ef0-aeec-3ed1134e5c86', 'Account 11', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('3411c69c-bfec-4d35-a6b9-27929f9d5bf6', '3411c69c-bfec-4d35-a6b9-27929f9d5bf6', 'Account 12', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('e053b254-5a3c-4b82-8ba0-fd6d0df231d3', 'e053b254-5a3c-4b82-8ba0-fd6d0df231d3', 'Account 13', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('26a35506-0631-4d79-9b4f-a8195b69c8ed', '26a35506-0631-4d79-9b4f-a8195b69c8ed', 'Stripe Current Assets', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()),
('d553cdbe-bc6b-46c2-aba8-f71aceedaf10', 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10', 'Payex Current Assets', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW());
