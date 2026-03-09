-- SupplierDetail: add bankHolder (Bank Holder) text
ALTER TABLE supplierdetail ADD COLUMN bankholder varchar(255) DEFAULT NULL;
