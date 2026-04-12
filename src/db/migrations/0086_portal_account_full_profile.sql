-- Portal 會員資料（擴展成完整單一資料源）
-- 目標：avatar / 身份證正反 / entity/reg/tax / bank_refund_remark 全部以 portal_account 為核心同步來源
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE portal_account
  ADD COLUMN avatar_url text NULL AFTER address,
  ADD COLUMN nricfront text NULL AFTER avatar_url,
  ADD COLUMN nricback text NULL AFTER nricfront,
  ADD COLUMN entity_type varchar(50) NULL AFTER nricback,
  ADD COLUMN reg_no_type varchar(50) NULL AFTER entity_type,
  ADD COLUMN tax_id_no varchar(50) NULL AFTER reg_no_type,
  ADD COLUMN bank_refund_remark text NULL AFTER tax_id_no;

