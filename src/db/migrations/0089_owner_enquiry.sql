-- Owner enquiry: owners looking for operator (no SaaS plan). Stored for proposal follow-up.

CREATE TABLE IF NOT EXISTS owner_enquiry (
  id varchar(36) NOT NULL,
  name varchar(255) DEFAULT NULL,
  company varchar(255) DEFAULT NULL,
  email varchar(255) NOT NULL,
  phone varchar(100) DEFAULT NULL,
  units varchar(50) DEFAULT NULL,
  message text DEFAULT NULL,
  country varchar(10) DEFAULT NULL,
  currency varchar(10) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_owner_enquiry_email (email),
  KEY idx_owner_enquiry_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
