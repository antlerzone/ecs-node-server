-- Backfill missing operator_signed_at when 0090 partially applied.

ALTER TABLE agreement ADD COLUMN operator_signed_at datetime DEFAULT NULL COMMENT 'When operator staff signed';
