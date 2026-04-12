-- Meter top-up cash invoice: store receipt (OR-*) + payment id like rentalcollection, for tenant UI "IV | OR" labels.
-- Run: node scripts/run-migration.js src/db/migrations/0152_metertransaction_accounting_receipt.sql

ALTER TABLE metertransaction
  ADD COLUMN accounting_receipt_document_number varchar(100) DEFAULT NULL COMMENT 'e.g. OR-00003 from sale payment' AFTER accounting_invoice_snapshot,
  ADD COLUMN accounting_receipt_snapshot longtext DEFAULT NULL COMMENT 'JSON: Bukku sale_payment payload' AFTER accounting_receipt_document_number,
  ADD COLUMN bukku_payment_id varchar(100) DEFAULT NULL COMMENT 'Bukku sale_payment transaction id' AFTER accounting_receipt_snapshot;
