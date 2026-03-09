/**
 * 清空 rentalcollection 表（便于重新导入 CSV 前使用）。
 * 用法：node scripts/truncate-rentalcollection.js
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
    await conn.query('TRUNCATE TABLE rentalcollection');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('rentalcollection table truncated.');
    console.log('Next: node scripts/import-rentalcollection.js rentalcollection.csv');
  } catch (err) {
    console.error('Truncate failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
