-- FAQ: 帮助页常见问题列表 (title, docs URL, created_at)
CREATE TABLE IF NOT EXISTS faq (
  id varchar(36) NOT NULL,
  title varchar(500) DEFAULT NULL,
  docs varchar(1000) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_faq_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ticket: 用户提交的 Request/Feedback 工单
CREATE TABLE IF NOT EXISTS ticket (
  id varchar(36) NOT NULL,
  mode varchar(50) NOT NULL DEFAULT 'help',
  description text,
  video varchar(1000) DEFAULT NULL,
  photo varchar(1000) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  ticketid varchar(50) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_client_id (client_id),
  KEY idx_ticket_created_at (created_at),
  KEY idx_ticket_ticketid (ticketid),
  CONSTRAINT fk_ticket_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
