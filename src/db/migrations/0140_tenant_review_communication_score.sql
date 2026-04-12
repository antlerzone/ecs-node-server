ALTER TABLE tenant_review
  ADD COLUMN communication_score decimal(4,2) NOT NULL DEFAULT 0 AFTER unit_care_score;
