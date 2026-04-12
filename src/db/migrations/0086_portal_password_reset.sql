-- Forgot password: store code and expiry; user receives email with code to reset.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_password_reset (
  email varchar(255) NOT NULL,
  code varchar(20) NOT NULL,
  expires_at datetime NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email),
  KEY idx_portal_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
