-- 1) Add propertydetail.wifi_id for JP Reference (internet type). 若列已存在会报 Duplicate column，可只执行下面 UPDATE。
ALTER TABLE propertydetail
  ADD COLUMN wifi_id varchar(255) DEFAULT NULL AFTER wifidetail;

-- 2) Backfill propertydetail.agreementtemplate_id from agreementtemplate (wix_id).
UPDATE propertydetail p
INNER JOIN agreementtemplate a ON a.wix_id = p.agreementtemplate_wixid AND p.agreementtemplate_wixid IS NOT NULL AND p.agreementtemplate_wixid != ''
SET p.agreementtemplate_id = a.id;
