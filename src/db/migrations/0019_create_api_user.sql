-- API 用户表：给第三方 Open API 用；新增 item 时手动填 username，token 系统自动生成；密码每用户单独设置（hash 储存），不建议使用 ECS 登入密码
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_user (
  id varchar(36) NOT NULL,
  username varchar(255) NOT NULL,
  password_hash varchar(255) DEFAULT NULL,
  token varchar(64) NOT NULL,
  status tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_user_username (username),
  UNIQUE KEY uk_api_user_token (token),
  KEY idx_api_user_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
