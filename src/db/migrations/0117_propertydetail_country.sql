-- Add country (MY/SG) to propertydetail for building name display and dropdown.
-- Run once: node scripts/run-migration.js src/db/migrations/0117_propertydetail_country.sql

ALTER TABLE propertydetail
  ADD COLUMN country varchar(10) DEFAULT NULL COMMENT 'MY or SG for display e.g. Building Name | MY';
