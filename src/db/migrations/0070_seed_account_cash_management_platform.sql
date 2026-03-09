-- 補齊會計科目：僅當 account 表「尚無」該 title 時才插入 Cash、Management Fees、Platform Collection。
-- 若已從 Wix 匯入或手動建好這些 title，可略過本 migration 或執行亦不會重複插入。
-- 執行：node scripts/run-migration.js src/db/migrations/0070_seed_account_cash_management_platform.sql

INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0001-4000-8000-000000000001', 'a1b2c3d4-0001-4000-8000-000000000001', 'Cash', 'asset', 'CURRENT_ASSET', NULL, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) = 'Cash' LIMIT 1);

INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0002-4000-8000-000000000002', 'a1b2c3d4-0002-4000-8000-000000000002', 'Management Fees', 'income', 'REVENUE', NULL, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) = 'Management Fees' LIMIT 1);

INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
SELECT 'a1b2c3d4-0003-4000-8000-000000000003', 'a1b2c3d4-0003-4000-8000-000000000003', 'Platform Collection', 'liability', 'CURRENT_LIABILITY', NULL, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) = 'Platform Collection' LIMIT 1);
