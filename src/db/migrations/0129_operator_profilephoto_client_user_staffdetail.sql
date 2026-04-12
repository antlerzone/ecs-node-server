-- Operator / contact-staff personal avatar URL (separate from clientdetail.profilephoto = company logo).
-- Run: node scripts/run-migration.js src/db/migrations/0129_operator_profilephoto_client_user_staffdetail.sql
--
-- NOTE: Use plain ALTER below. scripts/run-migration.js only executes statements that start with
-- CREATE|INSERT|ALTER|SET|UPDATE|DELETE|DROP — PREPARE/EXECUTE blocks are skipped, so dynamic SQL never ran.

ALTER TABLE client_user ADD COLUMN profilephoto TEXT DEFAULT NULL COMMENT 'Operator personal avatar (OSS URL), not company logo' AFTER name;

ALTER TABLE staffdetail ADD COLUMN profilephoto TEXT DEFAULT NULL COMMENT 'Staff avatar (OSS URL) for legacy Contact staff rows' AFTER name;
