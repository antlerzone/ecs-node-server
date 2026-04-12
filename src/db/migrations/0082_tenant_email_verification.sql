-- Tenant email change: double verification (code sent to new email).
-- One pending verification per tenant; new request overwrites previous.

CREATE TABLE IF NOT EXISTS tenant_email_verification (
  tenant_id varchar(36) NOT NULL,
  new_email varchar(255) NOT NULL,
  code varchar(10) NOT NULL,
  expires_at datetime NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id),
  KEY idx_tenant_email_verification_expires (expires_at),
  CONSTRAINT fk_tenant_email_verification_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
