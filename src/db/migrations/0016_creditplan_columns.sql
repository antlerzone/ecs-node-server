-- Creditplan: add client_wixid, client_id
ALTER TABLE creditplan ADD COLUMN client_wixid varchar(255) DEFAULT NULL;
ALTER TABLE creditplan ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE creditplan ADD KEY idx_creditplan_client_wixid (client_wixid);
ALTER TABLE creditplan ADD KEY idx_creditplan_client_id (client_id);
ALTER TABLE creditplan ADD CONSTRAINT fk_creditplan_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
