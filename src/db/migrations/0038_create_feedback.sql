-- Tenant Dashboard: feedback 表（租客提交的反馈）
-- 表名 feedback；含 client_id (FK → clientdetail.id)

CREATE TABLE IF NOT EXISTS feedback (
  id varchar(36) NOT NULL,
  tenancy_id varchar(36) DEFAULT NULL,
  room_id varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  description text,
  photo text DEFAULT NULL COMMENT 'JSON array of { src, type }',
  video varchar(500) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feedback_tenancy_id (tenancy_id),
  KEY idx_feedback_tenant_id (tenant_id),
  KEY idx_feedback_client_id (client_id),
  CONSTRAINT fk_feedback_tenancy
    FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_feedback_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_feedback_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
