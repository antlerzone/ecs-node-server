-- Cleanlemons: Dobi linen QR style (employee linens handoff).
-- Run: node scripts/run-migration.js src/db/migrations/0290_cln_dobi_linen_qr_style.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_dobi_operator_config`
  ADD COLUMN `linen_qr_style` ENUM('rotate_1min', 'permanent') NOT NULL DEFAULT 'rotate_1min'
  AFTER `handoff_wash_to_dry_warning_minutes`;
