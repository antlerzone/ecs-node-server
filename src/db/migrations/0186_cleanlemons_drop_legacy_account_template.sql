-- Remove obsolete Cleanlemons chart from migration 0177 (replaced by cln_account + cln_account_client).
-- Safe if tables were never created.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `cln_operator_account_mapping`;
DROP TABLE IF EXISTS `cln_operator_accounting_mapping`;
DROP TABLE IF EXISTS `cln_account_template`;
SET FOREIGN_KEY_CHECKS = 1;
