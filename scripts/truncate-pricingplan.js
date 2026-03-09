/**
 * Truncate pricingplan. Run before re-import. Run after truncate-pricingplanlogs (FK from logs to plan).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE pricingplan');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[truncate-pricingplan] Done.');
  } catch (err) {
    console.error('[truncate-pricingplan] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
