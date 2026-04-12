-- Platform Bukku cash invoice refs (Coliving parity: pricingplanlogs.invoiceid / invoiceurl)
ALTER TABLE cln_operator_subscription
  ADD COLUMN saas_bukku_invoice_id VARCHAR(100) DEFAULT NULL COMMENT 'Platform SaaS Bukku sales invoice id',
  ADD COLUMN saas_bukku_invoice_url VARCHAR(512) DEFAULT NULL COMMENT 'Platform SaaS Bukku invoice URL';

ALTER TABLE cln_operator_subscription_addon
  ADD COLUMN saas_bukku_invoice_id VARCHAR(100) DEFAULT NULL COMMENT 'Platform SaaS Bukku sales invoice id (add-on)',
  ADD COLUMN saas_bukku_invoice_url VARCHAR(512) DEFAULT NULL COMMENT 'Platform SaaS Bukku invoice URL (add-on)';
