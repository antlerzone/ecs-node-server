-- client_profile.stripe_platform: which Stripe platform account to use. MY = Malaysia (MYR), SG = Singapore (SGD). Default MY. Re-run safe (runner ignores ER_DUP_FIELDNAME).

ALTER TABLE client_profile ADD COLUMN stripe_platform varchar(10) NOT NULL DEFAULT 'MY' COMMENT 'MY=Malaysia Stripe, SG=Singapore Stripe';
