-- Template preview PDF (Node + Google API) stored on OSS (instant download for operator).
ALTER TABLE agreementtemplate
  ADD COLUMN preview_pdf_oss_url varchar(2048) DEFAULT NULL,
  ADD COLUMN preview_pdf_status varchar(32) DEFAULT NULL COMMENT 'pending|ready|failed',
  ADD COLUMN preview_pdf_error varchar(512) DEFAULT NULL;
