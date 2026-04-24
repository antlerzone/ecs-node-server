-- Cleanlemons: peer reviews (client↔operator, operator→staff). Run: node scripts/run-migration.js src/db/migrations/0301_cln_review.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_review` (
  `id` CHAR(36) NOT NULL,
  `review_kind` ENUM('client_to_operator','operator_to_client','operator_to_staff') NOT NULL,
  `operator_id` CHAR(36) NOT NULL COMMENT 'FK cln_operatordetail — company context',
  `schedule_id` CHAR(36) NULL COMMENT 'FK cln_schedule when job-linked',
  `stars` TINYINT UNSIGNED NOT NULL,
  `remark` TEXT NULL,
  `evidence_json` LONGTEXT NULL COMMENT 'JSON array of OSS URLs',
  `reviewer_portal_account_id` CHAR(36) NOT NULL,
  `subject_operator_id` CHAR(36) NULL COMMENT 'Rated operator (client_to_operator)',
  `subject_client_id` CHAR(36) NULL COMMENT 'Rated B2B client (operator_to_client)',
  `subject_employee_id` CHAR(36) NULL COMMENT 'Rated staff cln_employeedetail (operator_to_staff)',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_review_kind_schedule` (`review_kind`, `schedule_id`),
  KEY `idx_cln_review_operator` (`operator_id`),
  KEY `idx_cln_review_subject_op` (`subject_operator_id`),
  KEY `idx_cln_review_reviewer` (`reviewer_portal_account_id`),
  CONSTRAINT `fk_cln_review_operator` FOREIGN KEY (`operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_review_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `cln_schedule` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_review_portal_account` FOREIGN KEY (`reviewer_portal_account_id`) REFERENCES `portal_account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_review_subject_operator` FOREIGN KEY (`subject_operator_id`) REFERENCES `cln_operatordetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_review_subject_client` FOREIGN KEY (`subject_client_id`) REFERENCES `cln_clientdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_cln_review_subject_employee` FOREIGN KEY (`subject_employee_id`) REFERENCES `cln_employeedetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
