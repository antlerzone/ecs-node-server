-- Payment Verification & Payout: bank transactions, payment invoice, receipt, audit.
-- Ref: docs/saas-payment-verification-payout-prompt.md
-- Order: payment_receipt (no FK to invoice) -> payment_invoice -> bank_transactions -> add FKs.

-- 1) Receipt: image URL + OCR result. Links to payment_invoice when set.
CREATE TABLE IF NOT EXISTS payment_receipt (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  payment_invoice_id varchar(36) DEFAULT NULL,
  receipt_url varchar(1024) NOT NULL,
  ocr_result_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_receipt_client_id (client_id),
  KEY idx_payment_receipt_invoice (payment_invoice_id),
  CONSTRAINT fk_payment_receipt_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Payment invoice (logical invoice for verification). status: UNPAID | PENDING_VERIFICATION | PENDING_REVIEW | PAID | REJECTED
CREATE TABLE IF NOT EXISTS payment_invoice (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  external_invoice_id varchar(36) DEFAULT NULL,
  external_type varchar(50) DEFAULT NULL COMMENT 'rentalcollection|bill|manual',
  amount decimal(18,2) NOT NULL,
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  reference_number varchar(255) DEFAULT NULL,
  status varchar(50) NOT NULL DEFAULT 'UNPAID',
  receipt_id varchar(36) DEFAULT NULL,
  matched_bank_transaction_id varchar(36) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_invoice_client_id (client_id),
  KEY idx_payment_invoice_status (status),
  KEY idx_payment_invoice_reference (reference_number),
  KEY idx_payment_invoice_receipt (receipt_id),
  KEY idx_payment_invoice_matched_tx (matched_bank_transaction_id),
  CONSTRAINT fk_payment_invoice_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_payment_invoice_receipt
    FOREIGN KEY (receipt_id) REFERENCES payment_receipt (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Receipt -> invoice FK (optional back-reference)
ALTER TABLE payment_receipt
  ADD CONSTRAINT fk_payment_receipt_invoice
  FOREIGN KEY (payment_invoice_id) REFERENCES payment_invoice (id) ON UPDATE CASCADE ON DELETE SET NULL;

-- 4) Bank transactions from Finverse. Unique (client_id, finverse_transaction_id).
CREATE TABLE IF NOT EXISTS bank_transactions (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  finverse_transaction_id varchar(255) DEFAULT NULL,
  bank_account_id varchar(255) DEFAULT NULL,
  amount decimal(18,2) NOT NULL,
  currency varchar(10) NOT NULL DEFAULT 'MYR',
  reference varchar(500) DEFAULT NULL,
  description text DEFAULT NULL,
  payer_name varchar(255) DEFAULT NULL,
  transaction_date date DEFAULT NULL,
  matched_invoice_id varchar(36) DEFAULT NULL,
  raw_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_transactions_client_finverse (client_id, finverse_transaction_id),
  KEY idx_bank_transactions_client_id (client_id),
  KEY idx_bank_transactions_transaction_date (transaction_date),
  KEY idx_bank_transactions_matched_invoice (matched_invoice_id),
  CONSTRAINT fk_bank_transactions_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_bank_transactions_matched_invoice
    FOREIGN KEY (matched_invoice_id) REFERENCES payment_invoice (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) No FK from payment_invoice.matched_bank_transaction_id to bank_transactions (avoid cycle). App enforces consistency.

-- 6) Audit log for payment verification events
CREATE TABLE IF NOT EXISTS payment_verification_event (
  id varchar(36) NOT NULL,
  payment_invoice_id varchar(36) NOT NULL,
  event_type varchar(100) NOT NULL,
  payload_json json DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_verification_event_invoice (payment_invoice_id),
  KEY idx_payment_verification_event_created (created_at),
  CONSTRAINT fk_payment_verification_event_invoice
    FOREIGN KEY (payment_invoice_id) REFERENCES payment_invoice (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
