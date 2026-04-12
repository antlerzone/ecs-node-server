-- SAAS enquiry form: store remark, number of units, plan of interest for Enquiry tab detail.
-- Re-run safe (ADD COLUMN ignores if exists per runner).
ALTER TABLE client_profile
  ADD COLUMN enquiry_remark varchar(500) DEFAULT NULL COMMENT 'Enquiry form remark' AFTER is_demo,
  ADD COLUMN enquiry_units varchar(50) DEFAULT NULL COMMENT 'Enquiry: number of units' AFTER enquiry_remark,
  ADD COLUMN enquiry_plan_of_interest varchar(255) DEFAULT NULL COMMENT 'Enquiry: plan title or id' AFTER enquiry_units;
