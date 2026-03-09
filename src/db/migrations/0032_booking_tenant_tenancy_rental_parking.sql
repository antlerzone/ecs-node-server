-- Booking: multi-client tenant approval, tenancy JSON fields, rentalcollection.tenancy_id, parkinglot.available
-- 1) tenant_client: 多对多，租户可被多个 client 批准（FK 保持）
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

-- 2) tenantdetail.approval_request_json: 待批准列表 [{ clientId, status, createdAt }]
ALTER TABLE tenantdetail ADD COLUMN approval_request_json text DEFAULT NULL;

-- 3) tenancy: deposit + JSON 列（billing、addons、parkinglot、commission、tenancy_status、remark）
ALTER TABLE tenancy ADD COLUMN deposit decimal(18,2) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN parkinglot_json json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN addons_json json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN billing_json json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN commission_snapshot_json json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN billing_generated tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE tenancy ADD COLUMN tenancy_status_json json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN remark_json json DEFAULT NULL;

-- 4) rentalcollection.tenancy_id (FK → tenancy.id)，并依 tenancy_wix_id 回填
ALTER TABLE rentalcollection ADD COLUMN tenancy_id varchar(36) DEFAULT NULL;
ALTER TABLE rentalcollection ADD KEY idx_rentalcollection_tenancy_id (tenancy_id);
ALTER TABLE rentalcollection ADD CONSTRAINT fk_rentalcollection_tenancy
  FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE SET NULL;

UPDATE rentalcollection r
INNER JOIN tenancy t ON t.wix_id = r.tenancy_wix_id
SET r.tenancy_id = t.id
WHERE r.tenancy_wix_id IS NOT NULL AND TRIM(r.tenancy_wix_id) != '';

-- 5) parkinglot.available (boolean)
ALTER TABLE parkinglot ADD COLUMN available tinyint(1) NOT NULL DEFAULT 1;
