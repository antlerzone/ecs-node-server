-- Tenant e-sign timestamp (portal display + audit). Set by updateAgreementTenantSign when column exists.

ALTER TABLE agreement ADD COLUMN tenant_signed_at datetime DEFAULT NULL COMMENT 'When tenant signed (tenantsign)';
