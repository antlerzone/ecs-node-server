-- Coliving: operator-set tenant cleaning price + default account for cleaning income (rentalcollection.type_id).
-- Run: node scripts/run-migration.js src/db/migrations/0226_cleaning_tenant_price_and_account.sql

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- propertydetail: tenant-visible cleaning price (MYR); NULL = tenant portal hides cleaning for this property when room has no override
-- Plain ALTER (not PREPARE): dynamic EXECUTE of ALTER is unreliable; run-migration.js skips ER_DUP_FIELDNAME on re-run.
ALTER TABLE `propertydetail` ADD COLUMN `cleanlemons_cleaning_tenant_price_myr` DECIMAL(14,2) NULL COMMENT 'Operator price for tenant portal. NULL hides feature' AFTER `security_system`;

-- roomdetail: overrides property when set
ALTER TABLE `roomdetail` ADD COLUMN `cleanlemons_cleaning_tenant_price_myr` DECIMAL(14,2) NULL COMMENT 'Overrides property cleaning price for tenant';

INSERT INTO account (id, title, type, is_product, uses_platform_collection_gl, account_json, created_at, updated_at)
SELECT 'e1b2c3d4-2009-4000-8000-000000000309', 'Cleaning Services', 'income', 1, 0, NULL, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM account
  WHERE id = 'e1b2c3d4-2009-4000-8000-000000000309'
     OR TRIM(COALESCE(title, '')) = 'Cleaning Services'
  LIMIT 1
);
