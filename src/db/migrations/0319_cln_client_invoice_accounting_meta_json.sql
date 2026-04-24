-- Persist all accounting / portal invoice identifiers for audit (Bukku transaction id, doc no, portal draft INV-*, etc.).
SET @db := DATABASE();

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_client_invoice' AND column_name = 'accounting_meta_json'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE `cln_client_invoice` ADD COLUMN `accounting_meta_json` LONGTEXT NULL COMMENT ''JSON: portal draft no, provider, Bukku/Xero external ids, short links'' AFTER `pdf_url`',
  'SELECT ''skip: cln_client_invoice.accounting_meta_json exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
