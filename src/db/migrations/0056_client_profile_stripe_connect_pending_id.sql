-- Stripe Connect: pending account id before onboarding completes.
-- We only set stripe_connected_account_id when account.updated webhook has charges_enabled;
-- until then the new account id is stored here and reused for AccountLink.

ALTER TABLE client_profile
  ADD COLUMN stripe_connect_pending_id varchar(255) DEFAULT NULL
  AFTER stripe_connected_account_id;
