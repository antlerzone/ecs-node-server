-- rentalcollection: add _wixid columns for Wix export import (then backfill _id)
-- Match Wix row: tenant/room/property/type can be Wix ID on import
ALTER TABLE rentalcollection ADD COLUMN property_wixid varchar(255) DEFAULT NULL AFTER property_id;
ALTER TABLE rentalcollection ADD COLUMN room_wixid varchar(255) DEFAULT NULL AFTER room_id;
ALTER TABLE rentalcollection ADD COLUMN tenant_wixid varchar(255) DEFAULT NULL AFTER tenant_id;
ALTER TABLE rentalcollection ADD COLUMN type_wixid varchar(255) DEFAULT NULL AFTER type_id;
ALTER TABLE rentalcollection ADD KEY idx_rc_property_wixid (property_wixid);
ALTER TABLE rentalcollection ADD KEY idx_rc_room_wixid (room_wixid);
ALTER TABLE rentalcollection ADD KEY idx_rc_tenant_wixid (tenant_wixid);
ALTER TABLE rentalcollection ADD KEY idx_rc_type_wixid (type_wixid);

-- Bukku_invoice_id: allow text from Wix (was int)
ALTER TABLE rentalcollection MODIFY COLUMN bukku_invoice_id varchar(100) DEFAULT NULL;
