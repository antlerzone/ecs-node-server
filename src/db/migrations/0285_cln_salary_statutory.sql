-- MY statutory flags and amounts on salary row (MTD PCB EPF SOCSO EIS). Amounts are user or payroll-sourced.
-- Run: node scripts/run-migration.js src/db/migrations/0285_cln_salary_statutory.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_salary_record`
  ADD COLUMN `mtd_applies` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `epf_applies` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `socso_applies` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `eis_applies` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `mtd_amount` DECIMAL(12,2) NULL,
  ADD COLUMN `epf_amount` DECIMAL(12,2) NULL,
  ADD COLUMN `socso_amount` DECIMAL(12,2) NULL,
  ADD COLUMN `eis_amount` DECIMAL(12,2) NULL;
