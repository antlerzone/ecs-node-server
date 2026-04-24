-- Cleanlemons: store SCHEDULE_JOB_CREATE_JSON / EXTRACT_JSON machine lines outside operator-visible `content`.
-- Run: node scripts/run-migration.js src/db/migrations/0317_cln_operator_ai_chat_message_machine_append.sql
-- Re-run safe: duplicate column is skipped by run-migration.js (ER_DUP_FIELDNAME).

SET NAMES utf8mb4;

ALTER TABLE `cln_operator_ai_chat_message`
  ADD COLUMN `machine_append` MEDIUMTEXT NULL COMMENT 'Server-only machine lines not shown in portal chat' AFTER `content`;
