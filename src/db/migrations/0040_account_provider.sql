-- Account: add provider to support both Bukku and Xero (accounting addon).
-- Existing rows default to 'bukku'; new Xero-linked accounts use provider = 'xero'.
ALTER TABLE account ADD COLUMN provider varchar(50) DEFAULT 'bukku' AFTER client_id;
ALTER TABLE account ADD KEY idx_account_provider (provider);
