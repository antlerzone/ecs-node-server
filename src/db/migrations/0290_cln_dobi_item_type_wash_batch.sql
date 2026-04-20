-- Dobi: per–item-type wash batch size and wash duration (Malaysia ops: e.g. bedsheet 40 pcs / 45 min, towel 20 / 30).
-- Run: node scripts/run-migration.js src/db/migrations/0290_cln_dobi_item_type_wash_batch.sql

SET NAMES utf8mb4;

ALTER TABLE `cln_dobi_item_type`
  ADD COLUMN `wash_batch_pcs` INT NOT NULL DEFAULT 40 COMMENT 'Max pcs of this type per wash load' AFTER `active`,
  ADD COLUMN `wash_round_minutes` INT NOT NULL DEFAULT 45 COMMENT 'Planned wash duration for this type' AFTER `wash_batch_pcs`;
