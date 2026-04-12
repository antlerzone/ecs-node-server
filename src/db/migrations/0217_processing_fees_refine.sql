-- processing_fees: align with operator ledger (operatordetail), one row per (client_id, provider, payment_id).
-- gateway_fees_amount / total_fees_amount naming; gateway nullable when PSP does not return a fee.

SET @db = DATABASE();

-- Drop legacy unique that allowed multiple rows per payment (provider + payment_id + status).
SET @dropUk = (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = @db AND table_name = 'processing_fees' AND index_name = 'uk_processing_fees_provider_payment_status') > 0,
    'ALTER TABLE processing_fees DROP INDEX uk_processing_fees_provider_payment_status',
    'SELECT 1'
  )
);
PREPARE s1 FROM @dropUk;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- Rename amount columns if still using old names.
SET @has_gw_old = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'processing_fees' AND column_name = 'gateway_fee_amount'
);
SET @sql_gw = IF(
  @has_gw_old > 0,
  'ALTER TABLE processing_fees CHANGE COLUMN gateway_fee_amount gateway_fees_amount decimal(14,2) NULL DEFAULT NULL COMMENT ''PSP gateway fee when reported''',
  'SELECT 1'
);
PREPARE s2 FROM @sql_gw;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SET @has_tot_old = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'processing_fees' AND column_name = 'total_fee_amount'
);
SET @sql_tot = IF(
  @has_tot_old > 0,
  'ALTER TABLE processing_fees CHANGE COLUMN total_fee_amount total_fees_amount decimal(14,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE s3 FROM @sql_tot;
EXECUTE s3;
DEALLOCATE PREPARE s3;

-- If table was created with gateway_fees_amount already (re-run safe): ensure nullable
SET @has_gw_new = (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'processing_fees' AND column_name = 'gateway_fees_amount'
);
SET @sql_gw2 = IF(
  @has_gw_new > 0,
  'ALTER TABLE processing_fees MODIFY COLUMN gateway_fees_amount decimal(14,2) NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s4 FROM @sql_gw2;
EXECUTE s4;
DEALLOCATE PREPARE s4;

-- One row per operator payment (UPSERT target).
SET @has_uk_cpp = (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'processing_fees' AND index_name = 'uk_processing_fees_client_provider_payment'
);
SET @sql_uk = IF(
  @has_uk_cpp = 0,
  'ALTER TABLE processing_fees ADD UNIQUE KEY uk_processing_fees_client_provider_payment (client_id, provider, payment_id)',
  'SELECT 1'
);
PREPARE s5 FROM @sql_uk;
EXECUTE s5;
DEALLOCATE PREPARE s5;
