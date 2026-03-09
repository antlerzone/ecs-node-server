-- supplierdetail.productid: optional product id for purchase (e.g. Bukku product_id). Contact setting #inputproductid.
ALTER TABLE supplierdetail ADD COLUMN productid varchar(100) DEFAULT NULL;
