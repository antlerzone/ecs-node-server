-- UEN (Unique Entity Number) for Singapore operators. Shown in tenant PayNow modal so tenant can copy and pay in PayNow app.
ALTER TABLE client_profile ADD COLUMN uen varchar(20) DEFAULT NULL COMMENT 'Singapore UEN for PayNow pay-to-UEN' AFTER company_chop;
