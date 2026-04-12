-- Cleanlemons: per-operator account template mapping — align name with cln_operator.
-- Requires 0177 (table exists) and 0182 (parent cln_operator).

SET NAMES utf8mb4;

RENAME TABLE `cln_client_account_mapping` TO `cln_operator_account_mapping`;
