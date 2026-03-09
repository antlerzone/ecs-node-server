-- Stripe Connect: client's connected account id (acct_xxx) for receiving rent payments.
-- Used by stripe.service releaseRentToClient() to transfer funds after tenant pays.

ALTER TABLE client_profile
  ADD COLUMN stripe_connected_account_id varchar(255) DEFAULT NULL
  AFTER bank_id;
