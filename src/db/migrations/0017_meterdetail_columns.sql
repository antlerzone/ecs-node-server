-- Meterdetail: add room_wixid, room_id, property_wixid, property_id, customname, cnyiotmeterid, parentmeter_wixid
ALTER TABLE meterdetail ADD COLUMN room_wixid varchar(255) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN room_id varchar(36) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN property_wixid varchar(255) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN property_id varchar(36) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN customname varchar(255) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN cnyiotmeterid varchar(100) DEFAULT NULL;
ALTER TABLE meterdetail ADD COLUMN parentmeter_wixid varchar(255) DEFAULT NULL;
ALTER TABLE meterdetail ADD KEY idx_meterdetail_room_wixid (room_wixid);
ALTER TABLE meterdetail ADD KEY idx_meterdetail_room_id (room_id);
ALTER TABLE meterdetail ADD KEY idx_meterdetail_property_wixid (property_wixid);
ALTER TABLE meterdetail ADD KEY idx_meterdetail_property_id (property_id);
ALTER TABLE meterdetail ADD KEY idx_meterdetail_parentmeter_wixid (parentmeter_wixid);
ALTER TABLE meterdetail ADD CONSTRAINT fk_meterdetail_room
  FOREIGN KEY (room_id) REFERENCES roomdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE meterdetail ADD CONSTRAINT fk_meterdetail_property
  FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
