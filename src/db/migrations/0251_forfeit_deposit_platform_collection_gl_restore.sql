-- Forfeit Deposit invoice line: product from this row, GL from Platform Collection (same as Rental/Parking/Other PC lines).
-- Cash invoice pairs Deposit (deposit_items) with PC line (form_items) — DR Deposit / CR Platform Collection in substance.
-- Reverses 0250 flag-only change when product intent is PC + Forfeit product.
-- Run: node scripts/run-migration.js src/db/migrations/0251_forfeit_deposit_platform_collection_gl_restore.sql

SET NAMES utf8mb4;

UPDATE account
SET uses_platform_collection_gl = 1, updated_at = NOW()
WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85';
