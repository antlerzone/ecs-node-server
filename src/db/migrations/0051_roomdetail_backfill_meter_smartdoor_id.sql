-- roomdetail: backfill meter_id from meter_wixid (match meterdetail.wix_id), smartdoor_id from smartdoor_wixid (match lockdetail.wix_id).
-- 约定：业务用 _id，不再用 _wixid。跑完后 #dropdownmeter / #dropdownsmartdoor 可正确显示当前绑定值。
-- Run after import or when roomdetail has *_wixid but *_id is NULL.
-- ECS: mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0051_roomdetail_backfill_meter_smartdoor_id.sql

-- 1) meter_id: roomdetail.meter_wixid -> meterdetail.wix_id (normalize: TRIM, strip [] and !)
UPDATE roomdetail r
INNER JOIN meterdetail m
  ON TRIM(COALESCE(m.wix_id, '')) = TRIM(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(r.meter_wixid, '')), '[', ''), ']', ''), '!', ''))
SET r.meter_id = m.id,
    r.updated_at = NOW()
WHERE r.meter_wixid IS NOT NULL AND TRIM(r.meter_wixid) != '';

-- 2) smartdoor_id: roomdetail.smartdoor_wixid -> lockdetail.wix_id
UPDATE roomdetail r
INNER JOIN lockdetail l
  ON TRIM(COALESCE(l.wix_id, '')) = TRIM(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(r.smartdoor_wixid, '')), '[', ''), ']', ''), '!', ''))
SET r.smartdoor_id = l.id,
    r.updated_at = NOW()
WHERE r.smartdoor_wixid IS NOT NULL AND TRIM(r.smartdoor_wixid) != '';

-- 若表上尚无 FK，可取消下面注释执行（若已存在则先 DROP CONSTRAINT 再 ADD）:
-- ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_meter
--   FOREIGN KEY (meter_id) REFERENCES meterdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
-- ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_smartdoor
--   FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
