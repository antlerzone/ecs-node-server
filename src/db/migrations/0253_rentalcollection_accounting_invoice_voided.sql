-- rentalcollection: flag rows whose sales invoice was voided in accounting (operator delete/void flow).
-- Public tenant profile invoice history excludes accounting_invoice_voided = 1.
-- Run: node scripts/run-migration.js src/db/migrations/0253_rentalcollection_accounting_invoice_voided.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE rentalcollection
  ADD COLUMN accounting_invoice_voided TINYINT(1) NOT NULL DEFAULT 0
  COMMENT 'Sales invoice voided in accounting - omit from public profile payment history'
  AFTER updated_at;
