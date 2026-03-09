-- Create bills table when it does not exist (UtilityBills -> bill/bills).
-- Run when you get "Table 'myapp.bills' doesn't exist". Do not run 0012 after this.

CREATE TABLE IF NOT EXISTS bills (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  description text,
  billtype_id varchar(36) DEFAULT NULL,
  billtype_wixid varchar(255) DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  listingtitle varchar(255) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  property_wixid varchar(255) DEFAULT NULL,
  period datetime DEFAULT NULL,
  billurl varchar(500) DEFAULT NULL,
  billname varchar(255) DEFAULT NULL,
  client_wixid varchar(255) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  paid tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bills_wix_id (wix_id),
  KEY idx_bills_property_id (property_id),
  KEY idx_bills_property_wixid (property_wixid),
  KEY idx_bills_billtype_wixid (billtype_wixid),
  KEY idx_bills_client_wixid (client_wixid),
  KEY idx_bills_client_id (client_id),
  CONSTRAINT fk_bills_billtype
    FOREIGN KEY (billtype_id) REFERENCES account (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_bills_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_bills_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
