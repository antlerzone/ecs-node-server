-- API 文档访问控制：api_user 增加 can_access_docs，仅允许此标志为 1 的用户用 username+password 登录 portal /docs
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE api_user
  ADD COLUMN can_access_docs tinyint(1) NOT NULL DEFAULT 0
  AFTER status,
  ADD KEY idx_api_user_can_access_docs (can_access_docs);
