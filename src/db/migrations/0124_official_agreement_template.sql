-- Official agreement templates (platform catalog). Clients purchase with credit. .docx via Drive export (share Doc with SA).

CREATE TABLE IF NOT EXISTS official_agreement_template (
  id varchar(36) NOT NULL,
  agreementname VARCHAR(512) NOT NULL,
  url TEXT NOT NULL COMMENT 'Google Docs URL (template shared with service account)',
  credit INT NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_oat_active_sort (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_official_template_purchase (
  client_id varchar(36) NOT NULL,
  template_id varchar(36) NOT NULL,
  purchased_at DATETIME NOT NULL,
  PRIMARY KEY (client_id, template_id),
  KEY idx_cotp_template (template_id),
  CONSTRAINT fk_cotp_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON DELETE CASCADE,
  CONSTRAINT fk_cotp_template FOREIGN KEY (template_id) REFERENCES official_agreement_template (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
