-- PayNow QR image URL for Singapore operators. Shown in Company Setting when client currency is SGD.
-- Tenant uses this QR to pay via PayNow; operator uploads in Company Setting.
ALTER TABLE client_profile ADD COLUMN paynow_qr varchar(500) DEFAULT NULL COMMENT 'PayNow QR image URL (OSS); only for SGD clients' AFTER company_chop;
