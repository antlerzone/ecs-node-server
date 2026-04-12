/**
 * 删除 propertydetail 表并按新结构重建（reference = xxx_wixid + xxx_id）。
 * 用法：node scripts/reset-and-create-propertydetail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const createSql = `
CREATE TABLE propertydetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  percentage decimal(5,2) DEFAULT NULL,
  unitnumber varchar(500) DEFAULT NULL,
  shortname varchar(255) DEFAULT NULL,
  meter_wixid varchar(36) DEFAULT NULL,
  meter_id varchar(36) DEFAULT NULL,
  water varchar(255) DEFAULT NULL,
  signature text,
  tenancyenddate datetime DEFAULT NULL,
  agreementtemplate_wixid varchar(36) DEFAULT NULL,
  agreementtemplate_id varchar(36) DEFAULT NULL,
  remark text,
  apartmentname varchar(255) DEFAULT NULL,
  client_wixid varchar(36) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  management_wixid varchar(36) DEFAULT NULL,
  management_id varchar(36) DEFAULT NULL,
  address text,
  internettype_wixid varchar(36) DEFAULT NULL,
  internettype_id varchar(36) DEFAULT NULL,
  electric decimal(18,2) DEFAULT NULL,
  owner_wixid varchar(36) DEFAULT NULL,
  owner_id varchar(36) DEFAULT NULL,
  smartdoor_wixid varchar(36) DEFAULT NULL,
  smartdoor_id varchar(36) DEFAULT NULL,
  parkinglot text,
  signagreement varchar(500) DEFAULT NULL,
  agreementstatus text DEFAULT NULL,
  checkbox tinyint(1) DEFAULT NULL,
  wifidetail text,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_propertydetail_wix_id (wix_id),
  KEY idx_propertydetail_client_wixid (client_wixid),
  KEY idx_propertydetail_client_id (client_id),
  KEY idx_propertydetail_meter_wixid (meter_wixid),
  KEY idx_propertydetail_meter_id (meter_id),
  KEY idx_propertydetail_agreementtemplate_wixid (agreementtemplate_wixid),
  KEY idx_propertydetail_agreementtemplate_id (agreementtemplate_id),
  KEY idx_propertydetail_management_wixid (management_wixid),
  KEY idx_propertydetail_management_id (management_id),
  KEY idx_propertydetail_internettype_wixid (internettype_wixid),
  KEY idx_propertydetail_internettype_id (internettype_id),
  KEY idx_propertydetail_owner_wixid (owner_wixid),
  KEY idx_propertydetail_owner_id (owner_id),
  KEY idx_propertydetail_smartdoor_wixid (smartdoor_wixid),
  KEY idx_propertydetail_smartdoor_id (smartdoor_id),
  KEY idx_propertydetail_unitnumber (unitnumber),
  CONSTRAINT fk_propertydetail_client
    FOREIGN KEY (client_id) REFERENCES operatordetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_meter
    FOREIGN KEY (meter_id) REFERENCES meterdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_agreementtemplate
    FOREIGN KEY (agreementtemplate_id) REFERENCES agreementtemplate (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_management
    FOREIGN KEY (management_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_internettype
    FOREIGN KEY (internettype_id) REFERENCES supplierdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_owner
    FOREIGN KEY (owner_id) REFERENCES ownerdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_propertydetail_smartdoor
    FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  try {
    await conn.query('SET NAMES utf8mb4');
    await conn.query('DROP TABLE IF EXISTS propertydetail');
    console.log('[reset-propertydetail] Dropped propertydetail');
    await conn.query(createSql);
    console.log('[reset-propertydetail] Created propertydetail');
  } catch (err) {
    console.error('[reset-propertydetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
