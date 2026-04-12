-- Audit trail when tenant or operator changes handover check-in / check-out scheduled time (avoid silent reschedules).
CREATE TABLE IF NOT EXISTS tenancy_handover_schedule_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenancy_id VARCHAR(36) NOT NULL,
  client_id VARCHAR(36) NOT NULL,
  field_name VARCHAR(16) NOT NULL COMMENT 'checkin | checkout',
  old_value VARCHAR(80) NULL COMMENT 'normalized scheduledAt before change',
  new_value VARCHAR(80) NULL COMMENT 'normalized scheduledAt after change',
  actor_email VARCHAR(255) NULL,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'operator' COMMENT 'tenant | operator',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_handover_sched_log_tenancy (tenancy_id),
  KEY idx_handover_sched_log_client_time (client_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
