-- agreement: add columns for owner portal (owner, property, tenancy, mode, status, sign, template, pdfurl).
-- Used by owner portal: list by owner + mode, update ownersign/status.
-- Run once; if columns already exist, skip or run idempotent script.

ALTER TABLE agreement ADD COLUMN owner_id varchar(36) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN property_id varchar(36) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN tenancy_id varchar(36) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN agreementtemplate_id varchar(36) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN mode varchar(50) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN status varchar(50) DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN ownersign text DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN owner_signed_at datetime DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN tenantsign text DEFAULT NULL;
ALTER TABLE agreement ADD COLUMN pdfurl varchar(500) DEFAULT NULL;

ALTER TABLE agreement ADD KEY idx_agreement_owner_id (owner_id);
ALTER TABLE agreement ADD KEY idx_agreement_status (status);
ALTER TABLE agreement ADD KEY idx_agreement_mode (mode);
