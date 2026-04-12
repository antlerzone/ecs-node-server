/**
 * 只保留指定 client，删除其余 client 及所有表中属于其他 client 的数据。
 * Usage: node scripts/keep-only-one-client.js
 * 或: KEEP_CLIENT_ID=817f6510-47ac-4f8f-9828-d2fd91cb406f node scripts/keep-only-one-client.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const KEEP_CLIENT_ID = process.env.KEEP_CLIENT_ID || '817f6510-47ac-4f8f-9828-d2fd91cb406f';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    timezone: '+00:00'
  });

  const conn = await pool.getConnection();
  try {
    const dbName = process.env.DB_NAME;

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1) 查出所有带 client_id 列的表（排除 operatordetail 本身，稍后单独删）
    const [columns] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'client_id'
       ORDER BY TABLE_NAME`,
      [dbName]
    );
    const tablesWithClientId = columns.map((r) => r.TABLE_NAME);

    if (tablesWithClientId.length === 0) {
      console.log('No tables with client_id found.');
      const [delResult] = await conn.query('DELETE FROM operatordetail WHERE id != ?', [KEEP_CLIENT_ID]);
      console.log('operatordetail: deleted', delResult?.affectedRows ?? 0, 'rows (other clients).');
      return;
    }

    console.log('Tables with client_id:', tablesWithClientId.length);
    let totalDeleted = 0;

    // 2) 先删所有表中 client_id != 目标 的行（保留目标 client 的数据）
    for (const table of tablesWithClientId) {
      try {
        const [result] = await conn.query(
          `DELETE FROM \`${table}\` WHERE client_id IS NOT NULL AND client_id != ?`,
          [KEEP_CLIENT_ID]
        );
        const n = result.affectedRows ?? 0;
        if (n > 0) {
          console.log(`  ${table}: deleted ${n}`);
          totalDeleted += n;
        }
      } catch (e) {
        console.error(`  ${table}: ${e.message}`);
      }
    }

    // 3) 最后删 operatordetail 里其他 client
    const [clientResult] = await conn.query('DELETE FROM operatordetail WHERE id != ?', [KEEP_CLIENT_ID]);
    const clientDeleted = clientResult.affectedRows ?? 0;
    console.log('operatordetail: deleted', clientDeleted, 'rows (other clients).');
    totalDeleted += clientDeleted;

    console.log('Done. Kept only client', KEEP_CLIENT_ID, '| total rows deleted:', totalDeleted);
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
