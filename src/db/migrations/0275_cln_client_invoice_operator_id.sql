-- Issuing operator for B2B invoices (client portal filter + reporting).
SET @db := DATABASE();
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_client_invoice' AND column_name = 'operator_id'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE `cln_client_invoice` ADD COLUMN `operator_id` CHAR(36) NULL COMMENT ''FK company master (cln_operatordetail.id)'' AFTER `client_id`, ADD KEY `idx_cln_inv_operator` (`operator_id`)',
  'SELECT ''skip: cln_client_invoice.operator_id exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
