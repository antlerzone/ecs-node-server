/**
 * 删除 ownerdetail 表并按兼容结构重建。
 * 0142 后：不再包含 legacy 列 client_id / property_id（关系走 owner_client / owner_property）。
 * 用法：node scripts/reset-and-create-ownerdetail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const createSql = `
CREATE TABLE ownerdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  ownername varchar(255) DEFAULT NULL,
  bankname_wixid varchar(255) DEFAULT NULL,
  bankname_id varchar(36) DEFAULT NULL,
  bankaccount varchar(100) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  nric varchar(50) DEFAULT NULL,
  signature text,
  nricfront text,
  nricback text,
  accountholder varchar(255) DEFAULT NULL,
  mobilenumber varchar(100) DEFAULT NULL,
  status varchar(50) DEFAULT NULL,
  approvalpending text DEFAULT NULL,
  client_wixid varchar(255) DEFAULT NULL,
  property_wixid varchar(255) DEFAULT NULL,
  profile text DEFAULT NULL,
  account text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ownerdetail_wix_id (wix_id),
  KEY idx_ownerdetail_email (email),
  KEY idx_ownerdetail_client_wixid (client_wixid),
  KEY idx_ownerdetail_property_wixid (property_wixid),
  KEY idx_ownerdetail_bankname_wixid (bankname_wixid),
  KEY idx_ownerdetail_bankname_id (bankname_id),
  CONSTRAINT fk_ownerdetail_bankname
    FOREIGN KEY (bankname_id) REFERENCES bankdetail (id) ON UPDATE CASCADE ON DELETE SET NULL
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
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('DROP TABLE IF EXISTS ownerdetail');
    console.log('[reset-ownerdetail] Dropped ownerdetail');
    await conn.query(createSql);
    console.log('[reset-ownerdetail] Created ownerdetail');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (err) {
    console.error('[reset-ownerdetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
