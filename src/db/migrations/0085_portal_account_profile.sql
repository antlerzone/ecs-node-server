-- Portal 會員資料：一個 email 一份資料，與 tenantdetail/staffdetail/ownerdetail 同步用。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE portal_account
  ADD COLUMN fullname varchar(255) NULL AFTER facebook_id,
  ADD COLUMN phone varchar(100) NULL AFTER fullname,
  ADD COLUMN address text NULL AFTER phone,
  ADD COLUMN nric varchar(50) NULL AFTER address,
  ADD COLUMN bankname_id varchar(36) NULL AFTER nric,
  ADD COLUMN bankaccount varchar(100) NULL AFTER bankname_id,
  ADD COLUMN accountholder varchar(255) NULL AFTER bankaccount;
