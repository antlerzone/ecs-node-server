-- PropertyDetail: add folder (Google Drive folder ID for owner report PDF upload).
ALTER TABLE propertydetail ADD COLUMN folder varchar(255) DEFAULT NULL;
