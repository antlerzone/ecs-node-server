/**
 * Run a .sql file against DB from root .env (works in PowerShell; no shell redirection).
 *
 *   node scripts/run-mysql-sql-file.js src/db/migrations/0315_cln_client_invoice_payment_operator_id.sql
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const rel = process.argv[2];
if (!rel) {
  console.error('Usage: node scripts/run-mysql-sql-file.js <path-to.sql>');
  process.exit(1);
}
const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
if (!fs.existsSync(abs)) {
  console.error('File not found:', abs);
  process.exit(1);
}

(async () => {
  const sql = fs.readFileSync(abs, 'utf8');
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  await c.query(sql);
  console.log('OK executed:', abs);
  await c.end();
})().catch((e) => {
  console.error(e?.sqlMessage || e?.message || e);
  process.exit(1);
});
