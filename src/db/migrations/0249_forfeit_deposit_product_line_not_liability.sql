-- Forfeit Deposit: invoice product line only; GL via Platform Collection (uses_platform_collection_gl).
-- Not a `current_liabilities` row on the template — type stays NULL (same as Rental / Parking / Other PC lines).
-- Idempotent. Safe to re-run.
-- Run: node scripts/run-migration.js src/db/migrations/0249_forfeit_deposit_product_line_not_liability.sql

SET NAMES utf8mb4;

UPDATE account
SET
  type = NULL,
  is_product = 1,
  uses_platform_collection_gl = 1,
  updated_at = NOW()
WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85';
