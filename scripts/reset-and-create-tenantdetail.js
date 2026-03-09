/**
 * 删除 tenantdetail 表并按新结构重建。
 * 用法：node scripts/reset-and-create-tenantdetail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const createSql = `
CREATE TABLE tenantdetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  fullname varchar(255) DEFAULT NULL,
  nric varchar(50) DEFAULT NULL,
  address text,
  phone varchar(100) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  bankname_wixid varchar(255) DEFAULT NULL,
  bankname_id varchar(36) DEFAULT NULL,
  bankaccount varchar(100) DEFAULT NULL,
  accountholder varchar(255) DEFAULT NULL,
  nricfront text,
  nricback text,
  client_wixid varchar(255) DEFAULT NULL,
  client_id varchar(36) DEFAULT NULL,
  account text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenantdetail_wix_id (wix_id),
  KEY idx_tenantdetail_client_wixid (client_wixid),
  KEY idx_tenantdetail_client_id (client_id),
  KEY idx_tenantdetail_bankname_wixid (bankname_wixid),
  KEY idx_tenantdetail_bankname_id (bankname_id),
  KEY idx_tenantdetail_email (email),
  CONSTRAINT fk_tenantdetail_client
    FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_tenantdetail_bankname
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
    await conn.query('DROP TABLE IF EXISTS tenantdetail');
    console.log('[reset-tenantdetail] Dropped tenantdetail');
    await conn.query(createSql);
    console.log('[reset-tenantdetail] Created tenantdetail');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (err) {
    console.error('[reset-tenantdetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
