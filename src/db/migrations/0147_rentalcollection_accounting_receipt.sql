-- Bukku POST /sales/payments returns transaction (sale_payment) with number e.g. OR-00003, short_link.

ALTER TABLE rentalcollection
  ADD COLUMN accounting_receipt_document_number varchar(100) DEFAULT NULL COMMENT 'e.g. OR-00003 from payment/receipt' AFTER accounting_invoice_snapshot,
  ADD COLUMN accounting_receipt_snapshot longtext DEFAULT NULL COMMENT 'JSON: accounting payment transaction' AFTER accounting_receipt_document_number;
