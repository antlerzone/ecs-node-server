-- Portal profile extra identity fields for cross-role sync.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE portal_account
  ADD COLUMN first_name varchar(255) NULL AFTER fullname,
  ADD COLUMN last_name varchar(255) NULL AFTER first_name,
  ADD COLUMN id_type varchar(50) NULL AFTER reg_no_type;

