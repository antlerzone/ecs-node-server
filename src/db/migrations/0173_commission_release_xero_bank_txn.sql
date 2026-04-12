-- commission_release: Xero Spend Money (bank transaction) id when referral commission paid to staff.
ALTER TABLE commission_release
  ADD COLUMN xero_bank_transaction_id varchar(64) DEFAULT NULL COMMENT 'Xero BankTransactions.BankTransactionID for SPEND' AFTER bukku_expense_id;
