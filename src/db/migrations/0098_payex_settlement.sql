-- Payex settlement: store fetched settlement records per client for accounting/cron.
-- One row per settlement_id per client; raw_data = JSON array of API rows.

CREATE TABLE IF NOT EXISTS payex_settlement (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  settlement_id varchar(100) NOT NULL,
  date date DEFAULT NULL,
  gross_amount decimal(14,2) DEFAULT NULL,
  net_amount decimal(14,2) DEFAULT NULL,
  mdr decimal(14,2) DEFAULT NULL,
  raw_data json DEFAULT NULL,
  fetched_at datetime DEFAULT NULL,
  bukku_journal_id varchar(100) DEFAULT NULL,
  created_at datetime DEFAULT NULL,
  updated_at datetime DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payex_settlement_client_settlement (client_id, settlement_id),
  KEY idx_payex_settlement_client_id (client_id),
  KEY idx_payex_settlement_date (date),
  CONSTRAINT fk_payex_settlement_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE
);
