/**
 * Verify Dobi tables visible to the same DB pool as the API (reads root .env).
 * Usage: node scripts/check-dobi-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
const pool = require('../src/config/db');

async function main() {
  const dbName = process.env.DB_NAME || '(unset)';
  console.log('[check-dobi-db] .env DB_NAME =', dbName);

  const [[session]] = await pool.query('SELECT DATABASE() AS currentDb');
  console.log('[check-dobi-db] pool session DATABASE() =', session?.currentDb);

  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'cln_dobi_lot'`
  );
  const hasLot = Number(row?.n) > 0;
  console.log('[check-dobi-db] cln_dobi_lot exists =', hasLot ? 'YES' : 'NO');

  const [tables] = await pool.query(
    `SELECT table_name AS t FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name LIKE 'cln_dobi_%' ORDER BY table_name`
  );
  console.log('[check-dobi-db] cln_dobi_* in this database:', (tables || []).map((r) => r.t).join(', ') || '(none)');

  if (!hasLot) {
    console.log('\n[check-dobi-db] FIX: Run migrations against THIS database (see DB_NAME above), then restart npm run dev.');
    process.exitCode = 1;
  } else {
    console.log('\n[check-dobi-db] OK — if browser still shows 503, restart the API process (nodemon) so it reloads .env/pool.');
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
