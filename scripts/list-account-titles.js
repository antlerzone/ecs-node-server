/**
 * List account table rows (id, title, type) – use output as "default items" for docs.
 * Usage: node scripts/list-account-titles.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });
  try {
    const [rows] = await conn.query(
      'SELECT id, title, type, bukkuaccounttype FROM account ORDER BY title ASC'
    );
    console.log('# Default account items (from account table)\n');
    console.log('| id | title | type | bukkuaccounttype |');
    console.log('|----|-------|------|------------------|');
    for (const r of rows) {
      const id = (r.id || '').substring(0, 8) + '…';
      const title = String(r.title || '').replace(/\|/g, '\\|');
      const type = String(r.type || '');
      const bukku = String(r.bukkuaccounttype || '');
      console.log(`| ${id} | ${title} | ${type} | ${bukku} |`);
    }
    console.log('\n# Titles only (for doc)\n');
    rows.forEach((r) => console.log('-', r.title || '(no title)'));
  } finally {
    await conn.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
