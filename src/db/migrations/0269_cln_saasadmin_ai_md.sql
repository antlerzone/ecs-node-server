-- Platform SaaS admin: operator-AI constraint rules (Markdown fragments) for injection into operator LLM system prompts.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_saasadmin_ai_md` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(512) NOT NULL DEFAULT '',
  `body_md` LONGTEXT,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_saasadmin_ai_md_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
