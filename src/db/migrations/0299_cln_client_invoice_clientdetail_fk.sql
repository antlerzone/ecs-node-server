-- Cleanlemons B2B invoices: client_id / payment.client_id must reference cln_clientdetail (building client),
-- not cln_operatordetail (company master). Legacy FK came from renamed cln_client → cln_operatordetail chain.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @db := DATABASE();

-- Orphans: values that are not cln_clientdetail.id cannot satisfy the new FK.
UPDATE cln_client_invoice i
LEFT JOIN cln_clientdetail d ON d.id = i.client_id
SET i.client_id = NULL
WHERE i.client_id IS NOT NULL AND d.id IS NULL;

SET @has_pay_tbl := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_payment'
);
SET @sql_orphan_pay := IF(
  @has_pay_tbl > 0,
  'UPDATE cln_client_payment p LEFT JOIN cln_clientdetail d ON d.id = p.client_id SET p.client_id = NULL WHERE p.client_id IS NOT NULL AND d.id IS NULL',
  'SELECT ''skip: no cln_client_payment table'' AS msg'
);
PREPARE stmt_orphan_pay FROM @sql_orphan_pay;
EXECUTE stmt_orphan_pay;
DEALLOCATE PREPARE stmt_orphan_pay;

-- Drop legacy FK on invoice (name from 0176_cleanlemons_core.sql)
SET @inv_fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_invoice'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_cln_invoice_client'
  LIMIT 1
);
SET @sql_inv := IF(
  @inv_fk IS NOT NULL,
  'ALTER TABLE `cln_client_invoice` DROP FOREIGN KEY `fk_cln_invoice_client`',
  'SELECT ''skip: no fk_cln_invoice_client'' AS msg'
);
PREPARE stmt_inv FROM @sql_inv;
EXECUTE stmt_inv;
DEALLOCATE PREPARE stmt_inv;

-- Drop legacy FK on payment (table may be absent on partial installs)
SET @pay_fk := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_payment'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_cln_payment_client'
  LIMIT 1
);
SET @sql_pay := IF(
  @has_pay_tbl > 0 AND @pay_fk IS NOT NULL,
  'ALTER TABLE `cln_client_payment` DROP FOREIGN KEY `fk_cln_payment_client`',
  'SELECT ''skip: no fk_cln_payment_client'' AS msg'
);
PREPARE stmt_pay FROM @sql_pay;
EXECUTE stmt_pay;
DEALLOCATE PREPARE stmt_pay;

-- Add FK → cln_clientdetail (skip if already present)
SET @has_inv_new := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_invoice'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_cln_invoice_clientdetail'
);
SET @sql_inv2 := IF(
  @has_inv_new = 0,
  'ALTER TABLE `cln_client_invoice` ADD CONSTRAINT `fk_cln_invoice_clientdetail` FOREIGN KEY (`client_id`) REFERENCES `cln_clientdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''skip: fk_cln_invoice_clientdetail exists'' AS msg'
);
PREPARE stmt_inv2 FROM @sql_inv2;
EXECUTE stmt_inv2;
DEALLOCATE PREPARE stmt_inv2;

SET @has_pay_new := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'cln_client_payment'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = 'fk_cln_payment_clientdetail'
);
SET @sql_pay2 := IF(
  @has_pay_tbl > 0 AND @has_pay_new = 0,
  'ALTER TABLE `cln_client_payment` ADD CONSTRAINT `fk_cln_payment_clientdetail` FOREIGN KEY (`client_id`) REFERENCES `cln_clientdetail` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT ''skip: fk_cln_payment_clientdetail exists or no table'' AS msg'
);
PREPARE stmt_pay2 FROM @sql_pay2;
EXECUTE stmt_pay2;
DEALLOCATE PREPARE stmt_pay2;
