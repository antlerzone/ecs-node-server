-- Replace canonical Cleanlemons chart with GL accounts + pricing-aligned service products.
-- GL: Bank, Cash, Sales Income, Cost of Sales, Salaries & Wages, General Expenses.
-- Products: same 8 labels as `PRICING_SERVICES` in cleanlemon/next-app/lib/cleanlemon-pricing-services.ts
-- (order: general, deep, renovation, homestay, room-rental, commercial, office, dobi).
-- Clears per-operator mappings (cln_account_client) via CASCADE when cln_account rows are removed.

SET NAMES utf8mb4;

DELETE FROM `cln_account`;

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
  ('e0c10001-0000-4000-8000-000000000013', 'Salaries & Wages', 'expense', 0, 130),
  ('e0c10001-0000-4000-8000-000000000014', 'General Expenses', 'expense', 0, 140)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `type` = VALUES(`type`),
  `is_product` = VALUES(`is_product`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP(3);
