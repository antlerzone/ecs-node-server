-- Agreement extend (续约协议): 存储续约期限与备注，供 Tenancy Setting #sectionagreement 创建 extend agreement 时使用。
-- datepickeragreement1 → extend_begin_date, datepickeragreement2 → extend_end_date.

ALTER TABLE agreement ADD COLUMN extend_begin_date date DEFAULT NULL COMMENT 'Extend agreement period start (datepickeragreement1)';
ALTER TABLE agreement ADD COLUMN extend_end_date date DEFAULT NULL COMMENT 'Extend agreement period end (datepickeragreement2)';
ALTER TABLE agreement ADD COLUMN remark text DEFAULT NULL COMMENT 'Extend agreement remark';
