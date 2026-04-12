-- Agreement PDF flow: mode, property/tenancy refs, url, status, pdf_generating, sign fields.
-- Used by agreement PDF generation (Node + Google API) and finalize.

ALTER TABLE agreement
  ADD COLUMN mode varchar(50) DEFAULT NULL AFTER client_wixid,
  ADD COLUMN property_id varchar(36) DEFAULT NULL AFTER mode,
  ADD COLUMN tenancy_id varchar(36) DEFAULT NULL AFTER property_id,
  ADD COLUMN url varchar(1000) DEFAULT NULL AFTER tenancy_id,
  ADD COLUMN status varchar(50) DEFAULT NULL AFTER url,
  ADD COLUMN pdf_generating tinyint(1) NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN sign1 text DEFAULT NULL AFTER pdf_generating,
  ADD COLUMN sign2 text DEFAULT NULL AFTER sign1,
  ADD COLUMN tenantsign text DEFAULT NULL AFTER sign2,
  ADD COLUMN operatorsign text DEFAULT NULL AFTER tenantsign,
  ADD KEY idx_agreement_property_id (property_id),
  ADD KEY idx_agreement_tenancy_id (tenancy_id),
  ADD CONSTRAINT fk_agreement_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_agreement_tenancy
    FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE SET NULL;
