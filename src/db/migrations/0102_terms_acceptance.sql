-- Terms & Conditions acceptance: SaaS–Operator contract with signature + hash for non-repudiation.
-- One row per (client_id, document_type). Re-signing updates the same row or creates new by version.

CREATE TABLE IF NOT EXISTS terms_acceptance (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  document_type varchar(50) NOT NULL DEFAULT 'saas_operator',
  version varchar(50) NOT NULL DEFAULT '1.0',
  content_hash varchar(64) DEFAULT NULL COMMENT 'SHA256 of T&C text at sign time',
  signature text DEFAULT NULL,
  signed_at datetime DEFAULT NULL,
  signed_ip varchar(45) DEFAULT NULL,
  signature_hash varchar(64) DEFAULT NULL COMMENT 'SHA256(id+signature+signed_at+content_hash) for audit',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_terms_acceptance_client_doctype (client_id, document_type),
  KEY idx_terms_acceptance_client_id (client_id),
  CONSTRAINT fk_terms_acceptance_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
