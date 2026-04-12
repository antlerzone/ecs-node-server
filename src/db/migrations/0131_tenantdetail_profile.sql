-- Tenant Portal profile JSON: entity_type, reg_no_type, avatar_url, bank_refund_remark, etc.
-- Required for persisting avatar after refresh. Without this column, update-profile silently skipped avatar.

ALTER TABLE tenantdetail ADD COLUMN profile text DEFAULT NULL COMMENT 'JSON: entity_type, reg_no_type, avatar_url, bank_refund_remark';
