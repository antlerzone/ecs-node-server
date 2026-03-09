/**
 * 清空 clientdetail 及 4 张子表（client_integration, client_profile, client_pricingplan_detail, client_credit）。
 * 用法：node scripts/clear-client-and-subtables.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const TABLES = [
  'client_credit',
  'client_pricingplan_detail',
  'client_profile',
  'client_integration',
  'clientdetail',
];

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
    for (const table of TABLES) {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log('[clear]', table);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[clear] Done. You can re-upload clientdetail.csv and run import.');
  } catch (err) {
    console.error('[clear] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
