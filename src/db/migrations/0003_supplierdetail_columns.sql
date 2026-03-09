-- SupplierDetail: 增加 bankdetail / client 引用及 email、bankAccount、billerCode
-- 执行一次即可；若列已存在可跳过对应行
ALTER TABLE supplierdetail ADD COLUMN bankdetail_wixid varchar(255) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN bankdetail_id varchar(36) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN bankaccount varchar(255) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN email varchar(255) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN billercode varchar(100) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN client_wixid varchar(255) DEFAULT NULL;
ALTER TABLE supplierdetail ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE supplierdetail ADD KEY idx_supplierdetail_bankdetail_wixid (bankdetail_wixid);
ALTER TABLE supplierdetail ADD KEY idx_supplierdetail_bankdetail_id (bankdetail_id);
ALTER TABLE supplierdetail ADD KEY idx_supplierdetail_client_wixid (client_wixid);
ALTER TABLE supplierdetail ADD KEY idx_supplierdetail_client_id (client_id);
ALTER TABLE supplierdetail ADD CONSTRAINT fk_supplierdetail_bankdetail
  FOREIGN KEY (bankdetail_id) REFERENCES bankdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE supplierdetail ADD CONSTRAINT fk_supplierdetail_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
