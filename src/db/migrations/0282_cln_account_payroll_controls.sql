-- Cleanlemons operator accounting template: MY payroll liability controls + employer / MTD expense lines.
-- Idempotent. Run: node scripts/run-migration.js src/db/migrations/0282_cln_account_payroll_controls.sql

SET NAMES utf8mb4;

INSERT INTO `cln_account` (`id`, `title`, `type`, `is_product`, `sort_order`)
VALUES
  ('e0c10001-0000-4000-8000-000000000016', 'EPF Control', 'liability', 0, 25),
  ('e0c10001-0000-4000-8000-000000000017', 'SOCSO Control', 'liability', 0, 26),
  ('e0c10001-0000-4000-8000-000000000018', 'EIS Control', 'liability', 0, 27),
  ('e0c10001-0000-4000-8000-000000000019', 'MTD Control', 'liability', 0, 28),
  ('e0c10001-0000-4000-8000-000000000020', 'Salary Control', 'liability', 0, 29),
  ('e0c10001-0000-4000-8000-000000000021', 'EPF - Employer''s Contribution', 'expense', 0, 131),
  ('e0c10001-0000-4000-8000-000000000022', 'SOCSO - Employer''s Contribution', 'expense', 0, 132),
  ('e0c10001-0000-4000-8000-000000000023', 'EIS - Employer''s Contribution', 'expense', 0, 133),
  ('e0c10001-0000-4000-8000-000000000024', 'MTD - Employer''s Contribution', 'expense', 0, 134)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `type` = VALUES(`type`),
  `is_product` = VALUES(`is_product`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP(3);
