-- Operator signing: signed-at + hash for audit (non-repudiation).
-- operator_signed_hash = SHA256(agreementId + operatorsign + operator_signed_at + hash_draft).
--
-- Use plain ALTER statements so `node scripts/run-migration.js` (split on `;`) does not break
-- PREPARE/EXECUTE strings. Duplicate column is skipped by run-migration.js (ER_DUP_FIELDNAME).

ALTER TABLE agreement ADD COLUMN operator_signed_at datetime DEFAULT NULL COMMENT 'When operator staff signed';

ALTER TABLE agreement ADD COLUMN operator_signed_hash varchar(64) DEFAULT NULL COMMENT 'SHA256 audit for operator sign event';
