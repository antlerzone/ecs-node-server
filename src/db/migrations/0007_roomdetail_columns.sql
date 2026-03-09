-- RoomDetail: add property_wixid, meter_wixid, smartdoor_wixid for CSV; parkinglot, smartmeter, appointment, availabledate, msg, status, smartdoor_id
ALTER TABLE roomdetail ADD COLUMN property_wixid varchar(255) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN meter_wixid varchar(255) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN smartdoor_wixid varchar(255) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN smartdoor_id varchar(36) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN parkinglot varchar(255) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN smartmeter int DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN appointment varchar(500) DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN availabledate datetime DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN msg text DEFAULT NULL;
ALTER TABLE roomdetail ADD COLUMN status varchar(50) DEFAULT NULL;
ALTER TABLE roomdetail ADD KEY idx_roomdetail_property_wixid (property_wixid);
ALTER TABLE roomdetail ADD KEY idx_roomdetail_meter_wixid (meter_wixid);
ALTER TABLE roomdetail ADD KEY idx_roomdetail_smartdoor_wixid (smartdoor_wixid);
ALTER TABLE roomdetail ADD KEY idx_roomdetail_smartdoor_id (smartdoor_id);
ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_smartdoor
  FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
