/**
 * 清空 lockdetail 表所有数据（不删表结构）。
 * 用法：node scripts/truncate-lockdetail.js
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
    await conn.query('TRUNCATE TABLE lockdetail');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[truncate-lockdetail] Done. All rows removed.');
  } catch (err) {
    console.error('[truncate-lockdetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
