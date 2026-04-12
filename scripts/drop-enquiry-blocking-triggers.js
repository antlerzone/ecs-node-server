/**
 * Drop DB triggers that block enquiry submit (staffdetail FK error).
 * Run once if you see: "Cannot add or update a child row: ... staffdetail ... fk_staffdetail_client"
 *
 * Usage: node scripts/drop-enquiry-blocking-triggers.js
 * Requires: .env with DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 2,
  });

  const [triggers] = await pool.query(
    `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
     AND (
       (EVENT_OBJECT_TABLE = 'client_profile')
       OR (EVENT_OBJECT_TABLE = 'operatordetail' AND EVENT_MANIPULATION = 'BEFORE')
     )`
  );

  if (!triggers.length) {
    console.log('No blocking triggers found on client_profile or operatordetail (BEFORE).');
    await pool.end();
    return;
  }

  for (const t of triggers) {
    try {
      await pool.query(`DROP TRIGGER IF EXISTS \`${t.TRIGGER_NAME}\``);
      console.log('Dropped trigger:', t.TRIGGER_NAME, `(${t.EVENT_OBJECT_TABLE} ${t.EVENT_MANIPULATION})`);
    } catch (err) {
      console.warn('Failed to drop', t.TRIGGER_NAME, err.message);
    }
  }

  await pool.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
