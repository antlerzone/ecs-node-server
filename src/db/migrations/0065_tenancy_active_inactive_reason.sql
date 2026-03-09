-- Tenancy: active, inactive_reason, ttlock_passcode_expired_at (daily job sets inactive when unpaid, payment flow restores)
ALTER TABLE tenancy ADD COLUMN active tinyint(1) NOT NULL DEFAULT 1;
ALTER TABLE tenancy ADD COLUMN inactive_reason json DEFAULT NULL;
ALTER TABLE tenancy ADD COLUMN ttlock_passcode_expired_at datetime DEFAULT NULL;
ALTER TABLE tenancy ADD KEY idx_tenancy_active (active);
