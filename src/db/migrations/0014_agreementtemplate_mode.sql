-- AgreementTemplate: add mode column
ALTER TABLE agreementtemplate ADD COLUMN mode varchar(50) DEFAULT NULL;
