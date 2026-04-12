-- 0172 created gateway_fee_amount / total_fee_amount; app + 0217 expect gateway_fees_amount / total_fees_amount.
-- 0217 PREPARE blocks may not run correctly under scripts/run-migration.js (; splitting). This file is idempotent.

SET @db = DATABASE();

SET @has_old_gw := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'processing_fees' AND column_name = 'gateway_fee_amount'
);
SET @sql_rename := IF(
  @has_old_gw > 0,
  'ALTER TABLE processing_fees CHANGE COLUMN gateway_fee_amount gateway_fees_amount decimal(14,2) NULL DEFAULT NULL COMMENT ''PSP gateway fee when reported'', CHANGE COLUMN total_fee_amount total_fees_amount decimal(14,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt_rename FROM @sql_rename;
EXECUTE stmt_rename;
DEALLOCATE PREPARE stmt_rename;

SET @has_old_uk := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'processing_fees' AND index_name = 'uk_processing_fees_provider_payment_status'
);
SET @sql_drop_uk := IF(
  @has_old_uk > 0,
  'ALTER TABLE processing_fees DROP INDEX uk_processing_fees_provider_payment_status',
  'SELECT 1'
);
PREPARE stmt_drop FROM @sql_drop_uk;
EXECUTE stmt_drop;
DEALLOCATE PREPARE stmt_drop;

SET @has_new_uk := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = @db AND table_name = 'processing_fees' AND index_name = 'uk_processing_fees_client_provider_payment'
);
SET @sql_add_uk := IF(
  @has_new_uk = 0,
  'ALTER TABLE processing_fees ADD UNIQUE KEY uk_processing_fees_client_provider_payment (client_id, provider, payment_id)',
  'SELECT 1'
);
PREPARE stmt_uk FROM @sql_add_uk;
EXECUTE stmt_uk;
DEALLOCATE PREPARE stmt_uk;
