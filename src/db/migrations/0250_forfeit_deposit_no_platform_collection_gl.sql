-- Forfeit Deposit: product line uses operator's own Bukku account+product (account_client on this row).
-- Not uses_platform_collection_gl / not merged with Platform Collection mapping (unlike Rental/Parking/Other).
-- Idempotent. Safe to re-run.
-- Run: node scripts/run-migration.js src/db/migrations/0250_forfeit_deposit_no_platform_collection_gl.sql

SET NAMES utf8mb4;

UPDATE account
SET uses_platform_collection_gl = 0, updated_at = NOW()
WHERE id = '2020b22b-028e-4216-906c-c816dcb33a85';
