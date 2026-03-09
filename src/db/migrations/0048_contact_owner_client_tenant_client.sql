-- Contact 列表依赖：owner_client、tenant_client，以及 tenantdetail.approval_request_json。若已跑过 0032/0037 可跳过。
-- 用于修复 "Table 'myapp.owner_client' doesn't exist"。

-- tenantdetail.approval_request_json（待批准列表），若无则添加
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenantdetail' AND COLUMN_NAME = 'approval_request_json');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE tenantdetail ADD COLUMN approval_request_json text DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- owner_client: owner–client 多对多（Profile Contact 列表用）
CREATE TABLE IF NOT EXISTS owner_client (
  id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_owner_client (owner_id, client_id),
  KEY idx_owner_client_owner_id (owner_id),
  KEY idx_owner_client_client_id (client_id),
  CONSTRAINT fk_owner_client_owner FOREIGN KEY (owner_id) REFERENCES ownerdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_owner_client_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- tenant_client: tenant–client 多对多（Profile Contact 列表用）
CREATE TABLE IF NOT EXISTS tenant_client (
  tenant_id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, client_id),
  KEY idx_tenant_client_client_id (client_id),
  CONSTRAINT fk_tenant_client_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_tenant_client_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
