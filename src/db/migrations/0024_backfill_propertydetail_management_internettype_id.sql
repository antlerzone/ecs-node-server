-- Backfill propertydetail.management_id and internettype_id from supplierdetail (wix_id).
-- Rule: management_wixid / internettype_wixid → supplierdetail.wix_id → supplierdetail.id.

UPDATE propertydetail p
INNER JOIN supplierdetail s ON s.wix_id = p.management_wixid AND p.management_wixid IS NOT NULL AND p.management_wixid != ''
SET p.management_id = s.id;

UPDATE propertydetail p
INNER JOIN supplierdetail s ON s.wix_id = p.internettype_wixid AND p.internettype_wixid IS NOT NULL AND p.internettype_wixid != ''
SET p.internettype_id = s.id;
