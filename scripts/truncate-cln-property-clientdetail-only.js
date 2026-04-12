/**
 * Empty cln_property and cln_clientdetail for a clean Wix re-import.
 * TRUNCATEs child tables that reference cln_property / cln_clientdetail first (FK off).
 *
 *   node scripts/truncate-cln-property-clientdetail-only.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

/** Order: dependents first, then targets. Only tables that exist are truncated. */
const TRUNCATE_ORDER = [
  'cln_schedule',
  'cln_damage',
  'cln_property_link_request',
  'cln_property',
  'cln_client_operator',
  'cln_client_integration',
  'cln_clientdetail',
];

async function tableExists(conn, db, name) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1',
    [db, name]
  );
  return rows.length > 0;
}

async function columnExists(conn, db, table, col) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1',
    [db, table, col]
  );
  return rows.length > 0;
}

async function run() {
  const db = process.env.DB_NAME;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: db,
    charset: 'utf8mb4',
  });

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    if ((await tableExists(conn, db, 'ttlocktoken')) && (await columnExists(conn, db, 'ttlocktoken', 'clientdetail_id'))) {
      await conn.query('UPDATE `ttlocktoken` SET `clientdetail_id` = NULL WHERE `clientdetail_id` IS NOT NULL');
      console.log('UPDATE ttlocktoken SET clientdetail_id = NULL');
    }

    for (const t of TRUNCATE_ORDER) {
      if (await tableExists(conn, db, t)) {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
        console.log('TRUNCATE', t);
      } else {
        console.log('SKIP (missing)', t);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Done.');
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
