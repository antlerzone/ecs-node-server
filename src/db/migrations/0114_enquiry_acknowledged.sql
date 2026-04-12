-- Enquiry tab: mark as acknowledged so tab count shows only unacknowledged.
-- Re-run safe (ER_DUP_FIELDNAME skipped by runner).
ALTER TABLE client_profile
  ADD COLUMN enquiry_acknowledged_at datetime DEFAULT NULL COMMENT 'SAAS enquiry acknowledged by admin' AFTER enquiry_plan_of_interest;

ALTER TABLE owner_enquiry
  ADD COLUMN acknowledged_at datetime DEFAULT NULL COMMENT 'Management enquiry acknowledged by admin' AFTER updated_at;
