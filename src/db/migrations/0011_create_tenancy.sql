-- Create tenancy table when it does not exist (e.g. DB never ran full 0001).
-- Run this when you get "Table 'myapp.tenancy' doesn't exist".
-- Do not run 0010_tenancy_columns.sql after this (columns are already included).

CREATE TABLE IF NOT EXISTS tenancy (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  tenant_wixid varchar(255) DEFAULT NULL,
  room_id varchar(36) DEFAULT NULL,
  room_wixid varchar(255) DEFAULT NULL,
  begin datetime DEFAULT NULL,
  `end` datetime DEFAULT NULL,
  rental decimal(18,2) DEFAULT NULL,
  signagreement tinyint(1) NOT NULL DEFAULT 0,
  agreement text,
  checkbox tinyint(1) NOT NULL DEFAULT 0,
  submitby_id varchar(36) DEFAULT NULL,
  submitby_wixid varchar(255) DEFAULT NULL,
  sign text,
  status tinyint(1) NOT NULL DEFAULT 1,
  billsurl varchar(255) DEFAULT NULL,
  billsid varchar(100) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  password varchar(255) DEFAULT NULL,
  passwordid int DEFAULT NULL,
  availabledate datetime DEFAULT NULL,
  remark text,
  payment tinyint(1) NOT NULL DEFAULT 0,
  client_wixid varchar(255) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenancy_wix_id (wix_id),
  KEY idx_tenancy_tenant_id (tenant_id),
  KEY idx_tenancy_tenant_wixid (tenant_wixid),
  KEY idx_tenancy_room_id (room_id),
  KEY idx_tenancy_room_wixid (room_wixid),
  KEY idx_tenancy_submitby_id (submitby_id),
  KEY idx_tenancy_submitby_wixid (submitby_wixid),
  KEY idx_tenancy_client_wixid (client_wixid),
  KEY idx_tenancy_client_id (client_id),
  CONSTRAINT fk_tenancy_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenancy_room
    FOREIGN KEY (room_id) REFERENCES roomdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenancy_submitby
    FOREIGN KEY (submitby_id) REFERENCES staffdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenancy_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
