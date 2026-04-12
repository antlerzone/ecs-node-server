-- client_user: Company Setting 登入用户（Operator Portal），受 pricing plan user limit 限制。
-- staffdetail 仅用于 Contact Setting 员工 + accounting contact 同步；不再用于解析 Operator 身份。
CREATE TABLE IF NOT EXISTS client_user (
  id varchar(36) NOT NULL,
  client_id varchar(36) NOT NULL,
  email varchar(255) NOT NULL,
  name varchar(255) DEFAULT NULL,
  is_admin tinyint(1) NOT NULL DEFAULT 0 COMMENT '1=主账号(company email)，不可删',
  permission_json json DEFAULT NULL COMMENT 'array of permission keys, admin=>all',
  status tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_client_user_client_email (client_id, email),
  KEY idx_client_user_email (email),
  KEY idx_client_user_client (client_id),
  CONSTRAINT fk_client_user_client FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
