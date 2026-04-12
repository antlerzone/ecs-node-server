-- Cleanlemons: operator company row — rename cln_client → cln_operator.
-- Run once; FKs from cln_property / cln_client_invoice / etc. update with the parent rename.

SET NAMES utf8mb4;

RENAME TABLE `cln_client` TO `cln_operator`;
