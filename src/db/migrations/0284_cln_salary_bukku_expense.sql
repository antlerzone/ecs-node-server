-- Salary payout: Bukku Money Out (banking/expenses) id after mark paid.
-- Run: node scripts/run-migration.js src/db/migrations/0284_cln_salary_bukku_expense.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_salary_record`
  ADD COLUMN `bukku_expense_id` VARCHAR(64) NULL COMMENT 'Bukku banking expense Money Out id' AFTER `bukku_journal_id`;
