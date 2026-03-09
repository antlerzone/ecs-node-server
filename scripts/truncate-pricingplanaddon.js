/**
 * Truncate pricingplanaddon. Run before re-import.
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
    await conn.query('TRUNCATE TABLE pricingplanaddon');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[truncate-pricingplanaddon] Done.');
  } catch (err) {
    console.error('[truncate-pricingplanaddon] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
