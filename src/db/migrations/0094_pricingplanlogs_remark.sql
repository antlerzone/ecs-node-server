-- SaaS manual billing: remark for plan change type (new_customer / renew / upgrade)
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE pricingplanlogs ADD COLUMN remark varchar(64) DEFAULT NULL COMMENT 'new_customer|renew|upgrade' AFTER referencenumber;
