-- client_profile.stripe_sandbox: 1 = use Stripe test/sandbox (demo account), 0 = live. Default 0. Re-run safe (runner ignores ER_DUP_FIELDNAME).

ALTER TABLE client_profile ADD COLUMN stripe_sandbox tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=Stripe test/sandbox for demo, 0=live';
