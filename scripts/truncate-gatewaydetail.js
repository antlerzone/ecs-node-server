/**
 * 清空 gatewaydetail 表所有数据（不删表结构）。
 * 先清空 lockdetail 再清空 gatewaydetail，否则 FK 会阻止。
 * 用法：node scripts/truncate-gatewaydetail.js
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
    await conn.query('TRUNCATE TABLE gatewaydetail');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('[truncate-gatewaydetail] Done. All rows removed.');
  } catch (err) {
    console.error('[truncate-gatewaydetail] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
