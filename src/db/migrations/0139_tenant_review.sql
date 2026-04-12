CREATE TABLE IF NOT EXISTS tenant_review (
  id varchar(36) NOT NULL,
  tenant_id varchar(36) NOT NULL,
  tenant_email varchar(255) DEFAULT NULL,
  tenancy_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  operator_id varchar(36) DEFAULT NULL,
  payment_score_suggested decimal(4,2) NOT NULL DEFAULT 0,
  payment_score_final decimal(4,2) NOT NULL DEFAULT 0,
  unit_care_score decimal(4,2) NOT NULL DEFAULT 0,
  overall_score decimal(4,2) NOT NULL DEFAULT 0,
  late_payments_count int NOT NULL DEFAULT 0,
  outstanding_count int NOT NULL DEFAULT 0,
  badges_json json DEFAULT NULL,
  comment text,
  evidence_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenant_review_tenant_id (tenant_id),
  KEY idx_tenant_review_tenant_email (tenant_email),
  KEY idx_tenant_review_client_id (client_id),
  KEY idx_tenant_review_tenancy_id (tenancy_id),
  CONSTRAINT fk_tenant_review_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id)
      ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_tenant_review_tenancy
    FOREIGN KEY (tenancy_id) REFERENCES tenancy (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenant_review_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenant_review_operator
    FOREIGN KEY (operator_id) REFERENCES staffdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
