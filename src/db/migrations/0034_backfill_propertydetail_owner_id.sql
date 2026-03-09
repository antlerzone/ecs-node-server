-- Backfill propertydetail.owner_id from ownerdetail by owner_wixid = ownerdetail.wix_id.
-- Run once after import so that property has FK owner_id → ownerdetail(id).

UPDATE propertydetail p
INNER JOIN ownerdetail o ON TRIM(COALESCE(o.wix_id, '')) = TRIM(COALESCE(p.owner_wixid, ''))
SET p.owner_id = o.id
WHERE p.owner_wixid IS NOT NULL AND TRIM(p.owner_wixid) != '';
