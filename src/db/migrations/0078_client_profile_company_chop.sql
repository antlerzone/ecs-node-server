-- Company seal/chop image URL for agreement template variable {{clientchop}}.
-- Client uploads in Company Setting. Optional server-side white-background processing before save.
ALTER TABLE client_profile ADD COLUMN company_chop varchar(500) DEFAULT NULL COMMENT 'Company seal image URL (OSS or public) for agreement PDF' AFTER bank_id;
