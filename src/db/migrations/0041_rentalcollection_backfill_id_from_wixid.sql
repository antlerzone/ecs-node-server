-- After importing Wix export: backfill property_id, room_id, tenant_id, type_id from *_wixid
-- Run this AFTER you have imported rows with *_wixid set

UPDATE rentalcollection r
INNER JOIN propertydetail p ON p.wix_id = TRIM(r.property_wixid)
SET r.property_id = p.id
WHERE r.property_wixid IS NOT NULL AND TRIM(r.property_wixid) != '' AND r.property_id IS NULL;

UPDATE rentalcollection r
INNER JOIN roomdetail p ON p.wix_id = TRIM(r.room_wixid)
SET r.room_id = p.id
WHERE r.room_wixid IS NOT NULL AND TRIM(r.room_wixid) != '' AND r.room_id IS NULL;

UPDATE rentalcollection r
INNER JOIN tenantdetail p ON p.wix_id = TRIM(r.tenant_wixid)
SET r.tenant_id = p.id
WHERE r.tenant_wixid IS NOT NULL AND TRIM(r.tenant_wixid) != '' AND r.tenant_id IS NULL;

UPDATE rentalcollection r
INNER JOIN account p ON p.wix_id = TRIM(r.type_wixid)
SET r.type_id = p.id
WHERE r.type_wixid IS NOT NULL AND TRIM(r.type_wixid) != '' AND r.type_id IS NULL;
