-- Remove obsolete per-operator accounting tables (replaced by cln_account + cln_account_client).
-- cln_operator_account_mapping: from 0177/0183 template chart (0186 also drops if present).
-- cln_operator_accounting_mapping: old Node CREATE TABLE inline mapping (no longer read by API).

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `cln_operator_account_mapping`;
DROP TABLE IF EXISTS `cln_operator_accounting_mapping`;
SET FOREIGN_KEY_CHECKS = 1;
