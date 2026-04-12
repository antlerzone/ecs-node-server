-- Contact Setting: Staff section (add staff, edit staff account id).
-- Staff list uses staffdetail WHERE client_id = ?; account id stored in staffdetail.account (JSON, from 0057).
-- No schema change required; staffdetail.account already exists (migration 0057).
-- This migration is a no-op for documentation. Run: node scripts/run-migration.js (or paste into MySQL).

SELECT 1 AS contact_setting_staff_doc;
