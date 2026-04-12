-- Portal 手動註冊帳號：portal.colivingjb.com 用 email + 密碼 Sign up / Sign in 時存於此表；Google/Facebook 登入不寫入此表，僅用手動帳密需驗證。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_account (
  id varchar(36) NOT NULL,
  email varchar(255) NOT NULL,
  password_hash varchar(255) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_portal_account_email (email),
  KEY idx_portal_account_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
