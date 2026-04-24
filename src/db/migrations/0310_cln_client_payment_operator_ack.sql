-- Operator acknowledgment of client payments + longer Stripe session id for idempotency
SET @db = DATABASE();

-- Widen transaction_id for Stripe Checkout session ids (cs_live_… / cs_test_…)
SET @sql_widen = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = @db AND table_name = 'cln_client_payment' AND column_name = 'transaction_id'
        AND character_maximum_length >= 191
    ),
    'SELECT ''skip: cln_client_payment.transaction_id already wide'' AS msg',
    'ALTER TABLE `cln_client_payment` MODIFY COLUMN `transaction_id` VARCHAR(191) NULL'
  )
);
PREPARE stmt FROM @sql_widen;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql_ack = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = @db AND table_name = 'cln_client_payment' AND column_name = 'operator_ack_at'
    ),
    'SELECT ''skip: cln_client_payment.operator_ack_at exists'' AS msg',
    'ALTER TABLE `cln_client_payment` ADD COLUMN `operator_ack_at` DATETIME(3) NULL AFTER `updated_at`'
  )
);
PREPARE stmt2 FROM @sql_ack;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
