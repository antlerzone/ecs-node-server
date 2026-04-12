-- 在 mydb 的 account 表手動新增一筆「Processing Fees」模板（Xendit settlement 分錄用）。
-- 若已存在 title = 'Processing Fee' 或 'Processing Fees' 的列，可略過或改為 UPDATE。
-- 在 DMS 執行時請填寫 id、wix_id（可用同一 UUID），其餘依需要調整。

INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
VALUES (
  'a1b2c3d4-e5f6-4789-a012-345678901234',
  'a1b2c3d4-e5f6-4789-a012-345678901234',
  'Processing Fees',
  'expenses',
  'cost_of_sales',
  NULL,
  NOW(),
  NOW()
);

-- 若擔心重複，可改用：僅在尚無該 title 時插入（MySQL）
-- INSERT INTO account (id, wix_id, title, type, bukkuaccounttype, account_json, created_at, updated_at)
-- SELECT 'a1b2c3d4-e5f6-4789-a012-345678901234', 'a1b2c3d4-e5f6-4789-a012-345678901234', 'Processing Fees', 'expenses', 'cost_of_sales', NULL, NOW(), NOW()
-- FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM account WHERE TRIM(title) IN ('Processing Fee', 'Processing Fees') LIMIT 1);
