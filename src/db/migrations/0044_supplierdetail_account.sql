-- SupplierDetail: account (text) for JSON array [{ clientId, provider, id }] (Bukku/Xero contact id per client)
-- Run once; if column exists, ignore error.
ALTER TABLE supplierdetail ADD COLUMN account text DEFAULT NULL;
