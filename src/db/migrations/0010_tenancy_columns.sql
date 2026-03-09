-- Tenancy: add _wixid for CSV, password, passwordid, availabledate, remark, payment, client
ALTER TABLE tenancy ADD COLUMN tenant_wixid varchar(255) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN room_wixid varchar(255) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN submitby_wixid varchar(255) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN password varchar(255) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN passwordid int DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN availabledate datetime DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN remark text DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN payment tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE tenancy ADD COLUMN client_wixid varchar(255) DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE tenancy ADD KEY idx_tenancy_tenant_wixid (tenant_wixid);
ALTER TABLE tenancy ADD KEY idx_tenancy_room_wixid (room_wixid);
ALTER TABLE tenancy ADD KEY idx_tenancy_submitby_wixid (submitby_wixid);
ALTER TABLE tenancy ADD KEY idx_tenancy_client_wixid (client_wixid);
ALTER TABLE tenancy ADD KEY idx_tenancy_client_id (client_id);
ALTER TABLE tenancy ADD CONSTRAINT fk_tenancy_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
