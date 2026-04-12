-- api_user 关联 client：SaaS Admin 按 client 开通 API Docs，operator 用 portal 登录后按 client 判断是否可进 /docs
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE api_user
  ADD COLUMN client_id varchar(36) DEFAULT NULL AFTER username,
  ADD KEY idx_api_user_client_id (client_id);
