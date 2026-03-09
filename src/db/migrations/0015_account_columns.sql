-- Account (bukkuid): add type, client_wixid, client_id, productid
ALTER TABLE account ADD COLUMN type varchar(100) DEFAULT NULL;
ALTER TABLE account ADD COLUMN client_wixid varchar(255) DEFAULT NULL;
ALTER TABLE account ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE account ADD COLUMN productid int DEFAULT NULL;
ALTER TABLE account ADD KEY idx_account_client_wixid (client_wixid);
ALTER TABLE account ADD KEY idx_account_client_id (client_id);
ALTER TABLE account ADD CONSTRAINT fk_account_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
