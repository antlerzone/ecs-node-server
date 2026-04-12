-- Commission release (referral) reminder for operator. Created when booking has commission. Operator can set release_date, release_amount, mark as paid.
-- due_by_date = pay staff commission by this date (from client admin commission date). release_amount = referral to staff, balance (commission_amount - release_amount) stays in commission.

CREATE TABLE IF NOT EXISTS commission_release (
  id varchar(36) NOT NULL,
  tenancy_id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  property_id varchar(36) DEFAULT NULL,
  room_id varchar(36) DEFAULT NULL,
  tenant_id varchar(36) DEFAULT NULL,
  property_shortname varchar(255) DEFAULT NULL,
  room_title varchar(255) DEFAULT NULL,
  tenant_name varchar(255) DEFAULT NULL,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  commission_amount decimal(14,2) NOT NULL DEFAULT 0,
  chargeon varchar(20) DEFAULT 'owner' COMMENT 'tenant|owner',
  due_by_date date DEFAULT NULL COMMENT 'Pay staff commission by this date (from admin commission date)',
  release_amount decimal(14,2) DEFAULT NULL COMMENT 'Referral amount to staff, balance stays in commission',
  release_date date DEFAULT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending|paid',
  remark text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_commission_release_client (client_id),
  KEY idx_commission_release_tenancy (tenancy_id),
  KEY idx_commission_release_status (status),
  CONSTRAINT fk_commission_release_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_commission_release_tenancy FOREIGN KEY (tenancy_id) REFERENCES tenancy (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
