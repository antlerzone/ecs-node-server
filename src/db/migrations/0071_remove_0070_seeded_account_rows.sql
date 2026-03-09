-- 刪除 0070 新增的三筆 account（你表裡已有 Cash / Management Fees / Platform Collection，故移除重複）。
-- account_client 有 ON DELETE CASCADE，會一併刪除對應的 account_client 列。

DELETE FROM account WHERE id IN (
  'a1b2c3d4-0001-4000-8000-000000000001',
  'a1b2c3d4-0002-4000-8000-000000000002',
  'a1b2c3d4-0003-4000-8000-000000000003'
);
