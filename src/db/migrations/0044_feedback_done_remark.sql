-- Admin Dashboard: feedback 表增加 done、remark（标记完成与备注）
ALTER TABLE feedback ADD COLUMN done tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN remark text DEFAULT NULL;
