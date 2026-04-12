-- Bukku POST /sales/payments returns transaction.id (payment). Persist for receipt URLs when short_link missing.

ALTER TABLE rentalcollection
  ADD COLUMN bukku_payment_id varchar(100) DEFAULT NULL COMMENT 'Bukku sale_payment transaction id' AFTER accounting_receipt_snapshot;

-- Backfill from existing JSON snapshots (if any)
UPDATE rentalcollection
SET bukku_payment_id = JSON_UNQUOTE(JSON_EXTRACT(accounting_receipt_snapshot, '$.id'))
WHERE accounting_receipt_snapshot IS NOT NULL
  AND TRIM(accounting_receipt_snapshot) != ''
  AND JSON_VALID(accounting_receipt_snapshot)
  AND (bukku_payment_id IS NULL OR bukku_payment_id = '');

UPDATE rentalcollection
SET accounting_receipt_document_number = JSON_UNQUOTE(JSON_EXTRACT(accounting_receipt_snapshot, '$.number'))
WHERE accounting_receipt_snapshot IS NOT NULL
  AND TRIM(accounting_receipt_snapshot) != ''
  AND JSON_VALID(accounting_receipt_snapshot)
  AND (accounting_receipt_document_number IS NULL OR TRIM(accounting_receipt_document_number) = '');
