-- Cleanlemons operator salary: flexible payroll defaults, per-record inputs, allowance line meta.
-- Run: node scripts/run-migration.js src/db/migrations/0291_cln_salary_flex_payroll.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_operator_salary_settings`
  ADD COLUMN `payroll_defaults_json` JSON NULL COMMENT 'lateMode, denominators, defaultConditionalPolicy (Asia/Kuala_Lumpur business context)' AFTER `pay_days_json`;

ALTER TABLE `cln_salary_record`
  ADD COLUMN `payroll_inputs_json` JSON NULL COMMENT 'lateMinutes, lateCount, unpaidLeaveDays, optional overrides' AFTER `eis_amount`;

ALTER TABLE `cln_salary_line`
  ADD COLUMN `meta_json` JSON NULL COMMENT 'allowanceType fixed|conditional, conditionalPolicy, etc.' AFTER `amount`;
