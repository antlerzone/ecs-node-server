-- Unified tenant + owner reviews; FK to portal_account (NOT NULL) + subject_kind + business ids.
-- Replaces tenant_review / owner_review (renamed to *_deprecated after backfill).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `portal_account_review` (
  `id` varchar(36) NOT NULL,
  `subject_kind` enum('tenant','owner') NOT NULL,
  `portal_account_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) DEFAULT NULL,
  `owner_id` varchar(36) DEFAULT NULL,
  `tenancy_id` varchar(36) DEFAULT NULL,
  `client_id` varchar(36) DEFAULT NULL,
  `operator_id` varchar(36) DEFAULT NULL,
  `payment_score_suggested` decimal(4,2) NOT NULL DEFAULT 0,
  `payment_score_final` decimal(4,2) NOT NULL DEFAULT 0,
  `unit_care_score` decimal(4,2) NOT NULL DEFAULT 0,
  `communication_score` decimal(4,2) NOT NULL DEFAULT 0,
  `overall_score` decimal(4,2) NOT NULL DEFAULT 0,
  `late_payments_count` int NOT NULL DEFAULT 0,
  `outstanding_count` int NOT NULL DEFAULT 0,
  `badges_json` json DEFAULT NULL,
  `responsibility_score` decimal(4,2) NOT NULL DEFAULT 0,
  `cooperation_score` decimal(4,2) NOT NULL DEFAULT 0,
  `comment` text,
  `evidence_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_par_portal_account` (`portal_account_id`),
  KEY `idx_par_subject_tenant` (`subject_kind`, `tenant_id`),
  KEY `idx_par_subject_owner` (`subject_kind`, `owner_id`),
  KEY `idx_par_tenancy` (`tenancy_id`),
  KEY `idx_par_client` (`client_id`),
  KEY `idx_par_operator` (`operator_id`),
  CONSTRAINT `fk_par_portal_account` FOREIGN KEY (`portal_account_id`) REFERENCES `portal_account` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_par_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenantdetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_par_owner` FOREIGN KEY (`owner_id`) REFERENCES `ownerdetail` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_par_tenancy` FOREIGN KEY (`tenancy_id`) REFERENCES `tenancy` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_par_client` FOREIGN KEY (`client_id`) REFERENCES `clientdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_par_operator` FOREIGN KEY (`operator_id`) REFERENCES `staffdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- subject_kind vs tenant_id/owner_id consistency enforced in application (MySQL rejects CHECK that overlaps FK columns).

-- Backfill from tenant_review (skip rows with no resolvable portal_account_id)
INSERT INTO `portal_account_review` (
  `id`, `subject_kind`, `portal_account_id`, `tenant_id`, `owner_id`, `tenancy_id`, `client_id`, `operator_id`,
  `payment_score_suggested`, `payment_score_final`, `unit_care_score`, `communication_score`, `overall_score`,
  `late_payments_count`, `outstanding_count`, `badges_json`, `responsibility_score`, `cooperation_score`,
  `comment`, `evidence_json`, `created_at`, `updated_at`
)
SELECT
  tr.`id`,
  'tenant',
  COALESCE(td.`portal_account_id`, pa.`id`),
  tr.`tenant_id`,
  NULL,
  tr.`tenancy_id`,
  tr.`client_id`,
  tr.`operator_id`,
  tr.`payment_score_suggested`,
  tr.`payment_score_final`,
  tr.`unit_care_score`,
  COALESCE(tr.`communication_score`, 0),
  tr.`overall_score`,
  tr.`late_payments_count`,
  tr.`outstanding_count`,
  tr.`badges_json`,
  0,
  0,
  tr.`comment`,
  tr.`evidence_json`,
  tr.`created_at`,
  tr.`updated_at`
FROM `tenant_review` tr
INNER JOIN `tenantdetail` td ON td.`id` = tr.`tenant_id`
LEFT JOIN `portal_account` pa ON LOWER(TRIM(pa.`email`)) = LOWER(TRIM(td.`email`))
WHERE COALESCE(td.`portal_account_id`, pa.`id`) IS NOT NULL;

-- Backfill from owner_review
INSERT INTO `portal_account_review` (
  `id`, `subject_kind`, `portal_account_id`, `tenant_id`, `owner_id`, `tenancy_id`, `client_id`, `operator_id`,
  `payment_score_suggested`, `payment_score_final`, `unit_care_score`, `communication_score`, `overall_score`,
  `late_payments_count`, `outstanding_count`, `badges_json`, `responsibility_score`, `cooperation_score`,
  `comment`, `evidence_json`, `created_at`, `updated_at`
)
SELECT
  ow.`id`,
  'owner',
  COALESCE(od.`portal_account_id`, pa2.`id`),
  NULL,
  ow.`owner_id`,
  NULL,
  ow.`client_id`,
  ow.`operator_id`,
  0,
  0,
  0,
  ow.`communication_score`,
  ow.`overall_score`,
  0,
  0,
  NULL,
  ow.`responsibility_score`,
  ow.`cooperation_score`,
  ow.`comment`,
  ow.`evidence_json`,
  ow.`created_at`,
  ow.`updated_at`
FROM `owner_review` ow
INNER JOIN `ownerdetail` od ON od.`id` = ow.`owner_id`
LEFT JOIN `portal_account` pa2 ON LOWER(TRIM(pa2.`email`)) = LOWER(TRIM(od.`email`))
WHERE COALESCE(od.`portal_account_id`, pa2.`id`) IS NOT NULL;

-- Deprecate legacy tables (application uses portal_account_review only after this migration)
RENAME TABLE `tenant_review` TO `tenant_review_deprecated`;
RENAME TABLE `owner_review` TO `owner_review_deprecated`;
