-- Bills (UtilityBills): add property_wixid, billtype_wixid, billurl, billname, client_wixid, client_id, paid
ALTER TABLE bills ADD COLUMN property_wixid varchar(255) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN billtype_wixid varchar(255) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN billurl varchar(500) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN billname varchar(255) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN client_wixid varchar(255) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE bills ADD COLUMN paid tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE bills ADD KEY idx_bills_property_wixid (property_wixid);
ALTER TABLE bills ADD KEY idx_bills_billtype_wixid (billtype_wixid);
ALTER TABLE bills ADD KEY idx_bills_client_wixid (client_wixid);
ALTER TABLE bills ADD KEY idx_bills_client_id (client_id);
ALTER TABLE bills ADD CONSTRAINT fk_bills_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
