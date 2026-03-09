-- staffdetail.profile: JSON for entity_type, reg_no_type, tax_id_no (same shape as tenant profile section).
-- Used when staff edits own profile in sectionprofile (companysetting). Sectionprofile form matches tenant.
ALTER TABLE staffdetail ADD COLUMN profile text DEFAULT NULL COMMENT 'JSON: entity_type, reg_no_type, tax_id_no, etc.' AFTER permission_json;
