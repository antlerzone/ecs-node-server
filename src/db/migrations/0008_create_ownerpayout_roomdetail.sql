-- Create ownerpayout and roomdetail when they do not exist (e.g. DB never ran full 0001).
-- Run this instead of 0006+0007 when you get "Table ownerpayout/roomdetail doesn't exist".
-- If tables already exist, use 0006 and 0007 to add columns only.

CREATE TABLE IF NOT EXISTS ownerpayout (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  property_wixid varchar(255) DEFAULT NULL,
  totalcollection decimal(18,2) DEFAULT NULL,
  netpayout decimal(18,2) DEFAULT NULL,
  monthlyreport text,
  totalutility decimal(18,2) DEFAULT NULL,
  bukkubills varchar(255) DEFAULT NULL,
  bukkuinvoice varchar(500) DEFAULT NULL,
  totalrental decimal(18,2) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  period datetime DEFAULT NULL,
  expenses decimal(18,2) DEFAULT NULL,
  paid tinyint(1) NOT NULL DEFAULT 0,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ownerpayout_wix_id (wix_id),
  KEY idx_ownerpayout_client_id (client_id),
  KEY idx_ownerpayout_client_wixid (client_wixid),
  KEY idx_ownerpayout_property_id (property_id),
  KEY idx_ownerpayout_property_wixid (property_wixid),
  CONSTRAINT fk_ownerpayout_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_ownerpayout_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS roomdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  property_id varchar(36) DEFAULT NULL,
  property_wixid varchar(255) DEFAULT NULL,
  meter_id varchar(36) DEFAULT NULL,
  meter_wixid varchar(255) DEFAULT NULL,
  smartdoor_id varchar(36) DEFAULT NULL,
  smartdoor_wixid varchar(255) DEFAULT NULL,
  media_gallery_json json DEFAULT NULL,
  description_fld text,
  price decimal(18,2) DEFAULT NULL,
  availablesoon tinyint(1) NOT NULL DEFAULT 0,
  mainphoto text,
  availablefrom datetime DEFAULT NULL,
  availabledate datetime DEFAULT NULL,
  remark text,
  title_fld varchar(255) DEFAULT NULL,
  link_room_detail_title_fld varchar(255) DEFAULT NULL,
  available tinyint(1) NOT NULL DEFAULT 0,
  roomname varchar(255) DEFAULT NULL,
  active tinyint(1) NOT NULL DEFAULT 1,
  parkinglot varchar(255) DEFAULT NULL,
  smartmeter int DEFAULT NULL,
  appointment varchar(500) DEFAULT NULL,
  msg text DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_roomdetail_wix_id (wix_id),
  KEY idx_roomdetail_client_id (client_id),
  KEY idx_roomdetail_client_wixid (client_wixid),
  KEY idx_roomdetail_property_id (property_id),
  KEY idx_roomdetail_property_wixid (property_wixid),
  KEY idx_roomdetail_meter_id (meter_id),
  KEY idx_roomdetail_meter_wixid (meter_wixid),
  KEY idx_roomdetail_smartdoor_id (smartdoor_id),
  KEY idx_roomdetail_smartdoor_wixid (smartdoor_wixid),
  CONSTRAINT fk_roomdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_roomdetail_property
    FOREIGN KEY (property_id) REFERENCES propertydetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_roomdetail_meter
    FOREIGN KEY (meter_id) REFERENCES meterdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_roomdetail_smartdoor
    FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id)
      ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
