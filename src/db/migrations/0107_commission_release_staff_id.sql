-- commission_release: add staff_id (recipient of referral) and bukku_expense_id (money out transaction id in Bukku).
ALTER TABLE commission_release ADD COLUMN staff_id varchar(36) DEFAULT NULL COMMENT 'Staff who receives referral payment' AFTER chargeon;
ALTER TABLE commission_release ADD COLUMN bukku_expense_id varchar(64) DEFAULT NULL COMMENT 'Bukku banking/expenses id when money out created' AFTER remark;
ALTER TABLE commission_release ADD KEY idx_commission_release_staff (staff_id);
ALTER TABLE commission_release ADD CONSTRAINT fk_commission_release_staff FOREIGN KEY (staff_id) REFERENCES staffdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
