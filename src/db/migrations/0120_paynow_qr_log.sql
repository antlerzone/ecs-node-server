-- Log of PayNow QR upload/replace/clear for audit. One row per save.
CREATE TABLE IF NOT EXISTS paynow_qr_log (
  id varchar(36) NOT NULL PRIMARY KEY,
  client_id varchar(36) NOT NULL,
  uploaded_at datetime NOT NULL,
  uploaded_by_email varchar(255) NOT NULL,
  url varchar(500) DEFAULT NULL COMMENT 'New QR URL or NULL if cleared',
  created_at datetime NOT NULL,
  KEY idx_paynow_qr_log_client_id (client_id),
  KEY idx_paynow_qr_log_uploaded_at (uploaded_at)
);
