-- Partial salary payout (advance) before net is fully released — mark-paid can run multiple times per period row.
-- Run: node scripts/run-migration.js src/db/migrations/0293_cln_salary_status_partial_paid.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_salary_record`
  MODIFY COLUMN `status` ENUM('pending_sync','partial_paid','complete','void','archived') NOT NULL DEFAULT 'pending_sync';
