-- xendit_operator_payments: track each Xendit tenant payment across
-- 1) Payment success/failure (webhook)
-- 2) Received in operator sub-account (cron/settlement)
-- 3) Payout to bank + accounting journal (cron journal)
CREATE TABLE IF NOT EXISTS xendit_operator_payments (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL, -- operator's clientdetail.id
  provider varchar(20) NOT NULL DEFAULT 'xendit',
  payment_id varchar(100) NOT NULL, -- Xendit invoice external_id / transaction reference
  charge_type varchar(50) NOT NULL DEFAULT 'rental',
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  gross_amount decimal(14,2) NOT NULL DEFAULT 0.00,
  reference_number varchar(255) DEFAULT NULL,
  invoice_source varchar(50) DEFAULT NULL, -- rentalcollection | metertransaction
  invoice_record_id varchar(100) DEFAULT NULL, -- rentalcollection.id | metertransaction.id
  invoice_id varchar(100) DEFAULT NULL, -- internal invoiceid (bukku/Xero reference)

  -- Payment stage
  payment_status varchar(20) NOT NULL DEFAULT 'pending', -- pending|complete|failed
  paid_at datetime DEFAULT NULL,

  -- Settlement stage (master -> subaccount / operator receive)
  settlement_status varchar(20) NOT NULL DEFAULT 'pending', -- pending|received
  estimated_receive_at datetime DEFAULT NULL,
  received_at datetime DEFAULT NULL,

  -- Payout stage (subaccount -> bank)
  payout_status varchar(20) NOT NULL DEFAULT 'pending', -- pending|paid
  payout_at datetime DEFAULT NULL,
  accounting_journal_id varchar(255) DEFAULT NULL,

  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_xendit_operator_payment_client_payment (client_id, payment_id),
  KEY idx_xop_client_status (client_id, payment_status, settlement_status, payout_status)
  -- NOTE: foreign key omitted because existing `clientdetail` schema can be incompatible in type/collation.
  -- We still index via `client_id`.
);

