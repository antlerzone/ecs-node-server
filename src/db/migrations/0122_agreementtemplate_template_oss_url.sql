-- Agreement template: support template file from OSS instead of Google Doc URL.
-- When template_oss_url is set, preview/generate use the uploaded .docx from OSS.
ALTER TABLE agreementtemplate ADD COLUMN template_oss_url varchar(1024) DEFAULT NULL AFTER folderurl;
