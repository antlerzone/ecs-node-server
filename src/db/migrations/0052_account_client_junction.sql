-- Junction table: account <-> client mapping (one row per account + client + system).
-- Enables fast list/get by client_id with INDEX instead of parsing account_json.
-- Keep account_json in sync for backward compatibility.

CREATE TABLE IF NOT EXISTS account_client (
  account_id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  system varchar(50) NOT NULL,
  accountid varchar(255) DEFAULT NULL,
  product_id varchar(255) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, client_id, system),
  KEY idx_account_client_client_id (client_id),
  KEY idx_account_client_account_id (account_id),
  CONSTRAINT fk_account_client_account FOREIGN KEY (account_id) REFERENCES account (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_account_client_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
