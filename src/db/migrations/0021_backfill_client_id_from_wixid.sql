-- Backfill client_id from client_wixid for all tables that have both columns.
-- Matches clientdetail.wix_id = table.client_wixid. Run once after import.

-- tenantdetail
UPDATE tenantdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- client_integration
UPDATE client_integration t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- client_profile
UPDATE client_profile t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- client_pricingplan_detail
UPDATE client_pricingplan_detail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- client_credit
UPDATE client_credit t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- agreementtemplate
UPDATE agreementtemplate t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- gatewaydetail
UPDATE gatewaydetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- lockdetail
UPDATE lockdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- ownerdetail
UPDATE ownerdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- meterdetail
UPDATE meterdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- propertydetail
UPDATE propertydetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- roomdetail
UPDATE roomdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- ownerpayout
UPDATE ownerpayout t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- rentalcollection
UPDATE rentalcollection t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- staffdetail
UPDATE staffdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- agreement
UPDATE agreement t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- cnyiottokens
UPDATE cnyiottokens t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- parkinglot
UPDATE parkinglot t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- pricingplanlogs
UPDATE pricingplanlogs t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- ttlocktoken
UPDATE ttlocktoken t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- account
UPDATE account t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- creditplan
UPDATE creditplan t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- bills
UPDATE bills t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- tenancy
UPDATE tenancy t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- supplierdetail
UPDATE supplierdetail t
INNER JOIN clientdetail c ON c.wix_id = t.client_wixid
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';
