/**
 * 仅清空 `cln_damage`（Wix 导入 / 历史表），不动 `cln_damage_report`（工单 damage）。
 *
 *   node scripts/truncate-cln-damage-only.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const TABLE = 'cln_damage';

async function main() {
  const db = process.env.DB_NAME;
  if (!db) {
    console.error('Missing DB_NAME in .env');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    multipleStatements: false,
    charset: 'utf8mb4',
  });
  try {
    const [[row]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [db, TABLE]
    );
    if (!row || Number(row.n) === 0) {
      console.log('SKIP: table', TABLE, 'does not exist');
      return;
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query(`TRUNCATE TABLE \`${TABLE}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('OK: TRUNCATE', TABLE);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
