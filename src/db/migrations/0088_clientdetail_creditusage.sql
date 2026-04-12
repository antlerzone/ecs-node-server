-- Optional display text for billing/credit usage (e.g. rules or notes).
-- Run: node scripts/run-migration.js src/db/migrations/0088_clientdetail_creditusage.sql
-- If column already exists, script skips with [skip] duplicate column (ER_DUP_FIELDNAME).
ALTER TABLE clientdetail ADD COLUMN creditusage TEXT DEFAULT NULL;
