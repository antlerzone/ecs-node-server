-- SaaS platform admins (can access /saas-admin). Separate from clientdetail.email
-- which is the company master admin (per-client, cannot delete in company page).
CREATE TABLE IF NOT EXISTS saasadmin (
  id char(36) NOT NULL DEFAULT (UUID()),
  email varchar(255) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_saasadmin_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial SaaS admins (master admins of the platform)
INSERT IGNORE INTO saasadmin (id, email) VALUES
  (UUID(), 'starcity.shs@gmail.com'),
  (UUID(), 'antlerzone@gmail.com'),
  (UUID(), 'colivingmanagement@gmail.com');
