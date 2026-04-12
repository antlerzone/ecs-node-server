/**
 * Check if terms_acceptance table exists in the DB (same config as app).
 * Run: node scripts/check-terms-table.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });
  try {
    const [rows] = await conn.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'terms_acceptance'",
      [process.env.DB_NAME]
    );
    if (rows.length > 0) {
      console.log('OK: terms_acceptance table exists in', process.env.DB_NAME);
    } else {
      console.log('MISSING: terms_acceptance table not found in', process.env.DB_NAME);
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
