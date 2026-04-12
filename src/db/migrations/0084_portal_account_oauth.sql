-- Portal OAuth：Google/Facebook 登入時以 provider id 關聯；password_hash 可為 NULL（僅 OAuth 登入）。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE portal_account
  ADD COLUMN google_id varchar(255) NULL AFTER password_hash,
  ADD COLUMN facebook_id varchar(255) NULL AFTER google_id,
  ADD UNIQUE KEY uk_portal_account_google_id (google_id),
  ADD UNIQUE KEY uk_portal_account_facebook_id (facebook_id);

ALTER TABLE portal_account
  MODIFY COLUMN password_hash varchar(255) NULL;
