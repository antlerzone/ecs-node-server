-- Salary: Xero Accounting API external ids (MY path — Manual Journal accrual + Bank SPEND payout; not Payroll AU/NZ/UK).
-- Run: node scripts/run-migration.js src/db/migrations/0292_cln_salary_xero_accounting_ids.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_salary_record`
  ADD COLUMN `xero_manual_journal_id` VARCHAR(64) NULL COMMENT 'Xero ManualJournalID (accrual Dr Salary & Wages / Cr Salary Control)' AFTER `bukku_expense_id`,
  ADD COLUMN `xero_bank_transaction_id` VARCHAR(64) NULL COMMENT 'Xero BankTransactionID (SPEND net pay from Bank/Cash)' AFTER `xero_manual_journal_id`;
