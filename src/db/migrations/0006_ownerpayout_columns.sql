-- OwnerPayout: add property_wixid for CSV, bukkuinvoice, paid
ALTER TABLE ownerpayout ADD COLUMN property_wixid varchar(255) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN bukkuinvoice varchar(500) DEFAULT NULL;
ALTER TABLE ownerpayout ADD COLUMN paid tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE ownerpayout ADD KEY idx_ownerpayout_property_wixid (property_wixid);
