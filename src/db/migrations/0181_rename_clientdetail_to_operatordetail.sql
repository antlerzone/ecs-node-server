-- Rename core operator (company) master table: clientdetail → operatordetail.
-- Run once after deploying code that queries `operatordetail`.
-- FKs referencing clientdetail are updated by InnoDB on rename.

SET NAMES utf8mb4;

RENAME TABLE `clientdetail` TO `operatordetail`;
