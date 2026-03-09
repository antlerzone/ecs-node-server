-- Add staff_wixid and plan_wixid to pricingplanlogs for CSV import (Staff -> staff_wixid/staff_id, Planid -> plan_wixid/plan_id)

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE pricingplanlogs ADD COLUMN staff_wixid varchar(255) DEFAULT NULL AFTER staff_id;
ALTER TABLE pricingplanlogs ADD COLUMN plan_wixid varchar(255) DEFAULT NULL AFTER plan_id;
ALTER TABLE pricingplanlogs ADD KEY idx_pricingplanlogs_staff_wixid (staff_wixid);
ALTER TABLE pricingplanlogs ADD KEY idx_pricingplanlogs_plan_wixid (plan_wixid);
