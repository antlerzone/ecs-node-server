-- Issuing operator on B2B invoices + same on payment rows (reporting / multi-operator safety).
-- Idempotent: safe if 0275 already added invoice.operator_id.
SET @db := DATABASE();

-- 1) cln_client_invoice.operator_id
SET @has_inv_op := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_client_invoice' AND column_name = 'operator_id'
);
SET @sql_inv := IF(
  @has_inv_op = 0,
  'ALTER TABLE `cln_client_invoice` ADD COLUMN `operator_id` CHAR(36) NULL COMMENT ''FK company master (cln_operatordetail.id)'' AFTER `client_id`, ADD KEY `idx_cln_inv_operator` (`operator_id`)',
  'SELECT ''skip: cln_client_invoice.operator_id exists'' AS msg'
);
PREPARE stmt_inv FROM @sql_inv;
EXECUTE stmt_inv;
DEALLOCATE PREPARE stmt_inv;

-- 2) cln_client_payment.operator_id (table may be absent on very old DBs)
SET @has_pay_tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'cln_client_payment'
);
SET @has_pay_op := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cln_client_payment' AND column_name = 'operator_id'
);
SET @sql_pay := IF(
  @has_pay_tbl > 0 AND @has_pay_op = 0,
  'ALTER TABLE `cln_client_payment` ADD COLUMN `operator_id` CHAR(36) NULL COMMENT ''FK cln_operatordetail.id'' AFTER `invoice_id`, ADD KEY `idx_cln_pay_operator` (`operator_id`)',
  'SELECT ''skip: cln_client_payment.operator_id (no table or exists)'' AS msg'
);
PREPARE stmt_pay FROM @sql_pay;
EXECUTE stmt_pay;
DEALLOCATE PREPARE stmt_pay;

-- 3) Backfill invoice.operator_id: first linked operator per B2B client (MIN for stable choice)
UPDATE `cln_client_invoice` i
INNER JOIN (
  SELECT clientdetail_id, MIN(operator_id) AS operator_id
  FROM `cln_client_operator`
  GROUP BY clientdetail_id
) j ON j.clientdetail_id = i.client_id
SET i.operator_id = j.operator_id
WHERE i.client_id IS NOT NULL
  AND (i.operator_id IS NULL OR TRIM(COALESCE(i.operator_id, '')) = '');

-- 4) Backfill payment.operator_id from invoice
UPDATE `cln_client_payment` p
INNER JOIN `cln_client_invoice` i ON i.id = p.invoice_id
SET p.operator_id = NULLIF(TRIM(i.operator_id), '')
WHERE p.invoice_id IS NOT NULL
  AND i.operator_id IS NOT NULL
  AND TRIM(i.operator_id) <> ''
  AND (p.operator_id IS NULL OR TRIM(COALESCE(p.operator_id, '')) = '');
