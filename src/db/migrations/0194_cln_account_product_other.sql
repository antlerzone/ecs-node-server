-- Add "Other" service product to Cleanlemons accounting chart (matches operator/accounting product list).

SET NAMES utf8mb4;

INSERT INTO `cln_account` (`id`, `title`, `type`, `is_product`, `sort_order`)
VALUES
  ('e0c10001-0000-4000-8000-000000000015', 'Other', 'income', 1, 115)
ON DUPLICATE KEY UPDATE
  `title` = VALUES(`title`),
  `type` = VALUES(`type`),
  `is_product` = VALUES(`is_product`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP(3);
