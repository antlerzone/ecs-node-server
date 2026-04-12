-- Tenant signing audit hash for non-repudiation.
-- tenant_signed_hash = SHA256(agreementId + tenantsign + tenant_signed_at + hash_draft)

ALTER TABLE agreement ADD COLUMN tenant_signed_hash varchar(64) DEFAULT NULL COMMENT 'SHA256 audit for tenant sign event';
