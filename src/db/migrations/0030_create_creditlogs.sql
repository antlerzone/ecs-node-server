-- creditlogs: 充值/消费流水
-- 字段: Title, Amount, reference_number, payment, client_id, creditplan_id, staff_id, type,
--       sourplan_id, is_paid, txnid, payload, paiddate, remark, pricingplanlog_id, currency

CREATE TABLE IF NOT EXISTS creditlogs (
  id varchar(36) NOT NULL,
  title varchar(255) DEFAULT NULL,
  amount decimal(18,2) DEFAULT NULL,
  reference_number varchar(100) DEFAULT NULL,
  payment decimal(18,2) DEFAULT NULL,
  client_id varchar(36) NOT NULL,
  creditplan_id varchar(36) DEFAULT NULL,
  staff_id varchar(36) DEFAULT NULL,
  type varchar(50) DEFAULT NULL,
  sourplan_id varchar(36) DEFAULT NULL,
  is_paid tinyint(1) NOT NULL DEFAULT 0,
  txnid varchar(255) DEFAULT NULL,
  payload text DEFAULT NULL,
  paiddate datetime DEFAULT NULL,
  remark text DEFAULT NULL,
  pricingplanlog_id varchar(36) DEFAULT NULL,
  currency varchar(10) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_creditlogs_client_id (client_id),
  KEY idx_creditlogs_staff_id (staff_id),
  KEY idx_creditlogs_type (type),
  KEY idx_creditlogs_created_at (created_at),
  KEY idx_creditlogs_reference_number (reference_number),
  CONSTRAINT fk_creditlogs_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_creditlogs_staff
    FOREIGN KEY (staff_id) REFERENCES staffdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_creditlogs_creditplan
    FOREIGN KEY (creditplan_id) REFERENCES creditplan (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_creditlogs_sourplan
    FOREIGN KEY (sourplan_id) REFERENCES pricingplan (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_creditlogs_pricingplanlog
    FOREIGN KEY (pricingplanlog_id) REFERENCES pricingplanlogs (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
