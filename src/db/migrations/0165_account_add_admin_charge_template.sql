-- Add canonical account template: Admin Charge (Income + Product).
-- Run: node scripts/run-migration.js src/db/migrations/0165_account_add_admin_charge_template.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO account (id, title, type, is_product, uses_platform_collection_gl, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2008-4000-8000-000000000308', 'Admin Charge', 'income', 1, 0, NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM account
  WHERE id = 'e1b2c3d4-2008-4000-8000-000000000308'
     OR TRIM(COALESCE(title, '')) = 'Admin Charge'
  LIMIT 1
);
