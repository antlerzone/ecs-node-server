-- One client receipt upload can cover multiple invoices; operator approves/rejects the batch together.
SET @db := DATABASE();

SET @has_pay_tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_client_payment'
);
SET @has_batch := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_client_payment' AND column_name = 'receipt_batch_id'
);
SET @sql_batch := IF(
  @has_pay_tbl > 0 AND @has_batch = 0,
  'ALTER TABLE `cln_client_payment` ADD COLUMN `receipt_batch_id` CHAR(36) NULL COMMENT ''Same id for one multi-invoice portal upload'' AFTER `transaction_id`, ADD KEY `idx_cln_pay_receipt_batch` (`receipt_batch_id`)',
  'SELECT ''skip: cln_client_payment.receipt_batch_id (no table or exists)'' AS msg'
);
PREPARE stmt_batch FROM @sql_batch;
EXECUTE stmt_batch;
DEALLOCATE PREPARE stmt_batch;
