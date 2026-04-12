-- Scope agreement templates to cln_operator (each operator has own templates).
-- Plain ALTERs: run-migration.js splits on `;` and breaks PREPARE/IF blocks that span quotes.

SET NAMES utf8mb4;

ALTER TABLE `cln_operator_agreement_template`
  ADD COLUMN `operator_id` CHAR(36) NULL AFTER `id`;

ALTER TABLE `cln_operator_agreement_template`
  MODIFY COLUMN `operator_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

UPDATE `cln_operator_agreement_template` tpl
SET tpl.`operator_id` = (SELECT o.`id` FROM `cln_operator` o ORDER BY o.`id` LIMIT 1)
WHERE tpl.`operator_id` IS NULL
  AND (SELECT COUNT(*) FROM `cln_operator`) = 1;

CREATE INDEX `idx_cln_operator_agreement_template_operator_id` ON `cln_operator_agreement_template` (`operator_id`);

ALTER TABLE `cln_operator_agreement_template`
  ADD CONSTRAINT `fk_cln_operator_agreement_template_operator`
  FOREIGN KEY (`operator_id`) REFERENCES `cln_operator` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
