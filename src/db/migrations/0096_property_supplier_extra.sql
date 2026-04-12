-- 物业可绑定多个「供应商 + 账号/ID」（如 cukai harta、cukai tanah、indah water 等），供 Edit utility Add 与 expenses/bank transfer/jom pay 使用。
-- 若 Table 'myapp.property_supplier_extra' doesn't exist：先跑本档，再跑 0097_property_supplier_extra_slot.sql
CREATE TABLE IF NOT EXISTS property_supplier_extra (
  id varchar(36) NOT NULL,
  property_id varchar(36) NOT NULL,
  supplier_id varchar(36) NOT NULL,
  value varchar(500) DEFAULT NULL COMMENT 'Account no / ID for this supplier at this property',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_supplier_extra_property_id (property_id),
  KEY idx_property_supplier_extra_supplier_id (supplier_id),
  CONSTRAINT fk_property_supplier_extra_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_property_supplier_extra_supplier
    FOREIGN KEY (supplier_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
