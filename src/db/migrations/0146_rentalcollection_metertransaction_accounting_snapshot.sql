-- Bukku POST /sales/invoices returns { transaction: { id, number, short_link, ... } }.
-- Persist human-readable doc # and full payload for audit/UI.

ALTER TABLE rentalcollection
  ADD COLUMN accounting_document_number varchar(100) DEFAULT NULL COMMENT 'Accounting doc no e.g. IV-00231' AFTER invoiceurl,
  ADD COLUMN accounting_invoice_snapshot longtext DEFAULT NULL COMMENT 'JSON: accounting transaction object from provider' AFTER accounting_document_number;

ALTER TABLE metertransaction
  ADD COLUMN accounting_document_number varchar(100) DEFAULT NULL COMMENT 'Accounting doc no e.g. IV-00231' AFTER invoiceurl,
  ADD COLUMN accounting_invoice_snapshot longtext DEFAULT NULL COMMENT 'JSON: accounting transaction object from provider' AFTER accounting_document_number;
