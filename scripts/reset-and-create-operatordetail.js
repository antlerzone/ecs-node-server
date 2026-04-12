/**
 * 删除 operatordetail 表并按新结构重建。
 * 用法：node scripts/reset-and-create-operatordetail.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const createSql = `
CREATE TABLE operatordetail (
  id varchar(36) NOT NULL,
  wix_id varchar(36) DEFAULT NULL,
  title varchar(255) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  status tinyint(1) DEFAULT NULL,
  profilephoto text DEFAULT NULL,
  subdomain varchar(255) DEFAULT NULL,
  expired datetime DEFAULT NULL,
  pricingplan_wixid varchar(255) DEFAULT NULL,
  pricingplan_id varchar(36) DEFAULT NULL,
  currency varchar(20) DEFAULT NULL,
  admin text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_operatordetail_wix_id (wix_id),
  KEY idx_operatordetail_email (email),
  KEY idx_operatordetail_subdomain (subdomain),
  KEY idx_operatordetail_pricingplan_wixid (pricingplan_wixid),
  KEY idx_operatordetail_pricingplan_id (pricingplan_id),
  CONSTRAINT fk_operatordetail_pricingplan
    FOREIGN KEY (pricingplan_id) REFERENCES pricingplan (id) ON UPDATE CASCADE ON DELETE SET NULL
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
    await conn.query('DROP TABLE IF EXISTS operatordetail');
    console.log('[reset-operatordetail] Dropped operatordetail');
    await conn.query(createSql);
    console.log('[reset-operatordetail] Created operatordetail');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (err) {
    console.error('[reset-operatordetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
