-- Allow terms acceptance by api_user when operator has no client (e.g. SaaS admin or not yet linked).
-- One row per (client_id, document_type) or per (api_user_id, document_type); client_id nullable when api_user_id set.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE terms_acceptance
  ADD COLUMN api_user_id varchar(36) NULL AFTER client_id,
  MODIFY COLUMN client_id varchar(36) NULL,
  ADD UNIQUE KEY uk_terms_acceptance_api_user_doctype (api_user_id, document_type),
  ADD CONSTRAINT fk_terms_acceptance_api_user
    FOREIGN KEY (api_user_id) REFERENCES api_user (id) ON UPDATE CASCADE ON DELETE CASCADE;
