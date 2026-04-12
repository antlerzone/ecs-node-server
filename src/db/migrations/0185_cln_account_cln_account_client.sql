-- Cleanlemons Portal accounting: template chart (cln_account) + per-operator external IDs (cln_account_client).
-- Mirrors SaaS account / account_client pattern for api.cleanlemons.com → portal.cleanlemons.com/operator/accounting.
-- FK only on account_id; operator_id is VARCHAR(64) to allow portal ids (e.g. op_demo_001) without cln_operator row.
-- Existing DBs that already have clm_account / clm_account_client: run `node scripts/rename-clm-to-cln-tables.js` once.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `cln_account` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL COMMENT 'Display name / internal label (was cleanlemons_account)',
  `type` VARCHAR(32) NOT NULL DEFAULT 'income' COMMENT 'income|expense|asset|liability',
  `is_product` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_cln_account_sort` (`sort_order`),
  KEY `idx_cln_account_title` (`title`(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cln_account_client` (
  `id` CHAR(36) NOT NULL,
  `operator_id` VARCHAR(64) NOT NULL COMMENT 'Cleanlemons operator id (cln_operator.id or portal operatorId)',
  `account_id` CHAR(36) NOT NULL COMMENT 'FK cln_account.id',
  `external_account` VARCHAR(128) NOT NULL DEFAULT '' COMMENT 'Remote GL / account code or id',
  `external_product` VARCHAR(128) NULL COMMENT 'Remote product / item id when is_product',
  `system` VARCHAR(32) NOT NULL DEFAULT 'bukku' COMMENT 'bukku|xero|…',
  `mapped` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cln_acct_client_op_acct_sys` (`operator_id`, `account_id`, `system`),
  KEY `idx_cln_acct_client_operator` (`operator_id`),
  KEY `idx_cln_acct_client_account` (`account_id`),
  CONSTRAINT `fk_cln_acct_client_account`
    FOREIGN KEY (`account_id`) REFERENCES `cln_account` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canonical chart: 6 GL + 8 service products (aligned with portal/operator/pricing SERVICES).
-- Superseded seed updates: 0189_cln_account_pricing_chart.sql (existing DBs).
INSERT INTO `cln_account` (`id`, `title`, `type`, `is_product`, `sort_order`)
VALUES
  ('e0c10001-0000-4000-8000-000000000001', 'Bank', 'asset', 0, 10),
  ('e0c10001-0000-4000-8000-000000000002', 'Cash', 'asset', 0, 20),
  ('e0c10001-0000-4000-8000-000000000003', 'Sales Income', 'income', 0, 30),
  ('e0c10001-0000-4000-8000-000000000004', 'General Cleaning', 'income', 1, 40),
  ('e0c10001-0000-4000-8000-000000000005', 'Deep Cleaning', 'income', 1, 50),
  ('e0c10001-0000-4000-8000-000000000006', 'Renovation Cleaning', 'income', 1, 60),
  ('e0c10001-0000-4000-8000-000000000007', 'Homestay Cleaning', 'income', 1, 70),
  ('e0c10001-0000-4000-8000-000000000008', 'Room Rental Cleaning', 'income', 1, 80),
  ('e0c10001-0000-4000-8000-000000000009', 'Commercial Cleaning', 'income', 1, 90),
  ('e0c10001-0000-4000-8000-000000000010', 'Office Cleaning', 'income', 1, 100),
  ('e0c10001-0000-4000-8000-000000000011', 'Dobi Services', 'income', 1, 110),
  ('e0c10001-0000-4000-8000-000000000012', 'Cost of Sales', 'expense', 0, 120),
  ('e0c10001-0000-4000-8000-000000000013', 'Salary & Wages', 'expense', 0, 130),
  ('e0c10001-0000-4000-8000-000000000014', 'General Expenses', 'expense', 0, 140)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `type` = VALUES(`type`),
  `is_product` = VALUES(`is_product`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP(3);
