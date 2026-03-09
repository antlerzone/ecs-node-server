-- client_profile.is_demo: 1 = demo account (daily 12am reset, stripe sandbox, exclude from pricing expiry). Re-run safe.
ALTER TABLE client_profile ADD COLUMN is_demo tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=demo account, reset daily' AFTER stripe_platform;
