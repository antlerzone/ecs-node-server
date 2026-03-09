/**
 * 给所有已有 client_id 但缺 client_wixid 的表加上 client_wixid 列和索引。
 * 用法：node scripts/sync-client-wixid-all-tables.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const TABLES_WITH_CLIENT = [
  'tenantdetail', 'client_integration', 'client_profile', 'client_pricingplan_detail',
  'client_credit', 'agreementtemplate', 'gatewaydetail', 'lockdetail', 'meterdetail',
  'propertydetail', 'roomdetail', 'ownerpayout', 'rentalcollection', 'staffdetail',
  'agreement', 'cnyiottokens', 'parkinglot', 'pricingplanlogs', 'ttlocktoken'
];

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const dbName = process.env.DB_NAME;
  let added = 0;

  try {
    for (const table of TABLES_WITH_CLIENT) {
      const [tables] = await conn.query(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [dbName, table]
      );
      if (tables.length === 0) continue;

      const [cols] = await conn.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
        [dbName, table]
      );
      const names = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));
      if (!names.has('client_id') || names.has('client_wixid')) continue;

      await conn.query(
        `ALTER TABLE \`${table}\` ADD COLUMN client_wixid varchar(36) DEFAULT NULL`
      );
      const idxName = `idx_${table}_client_wixid`;
      try {
        await conn.query(`ALTER TABLE \`${table}\` ADD KEY ${idxName} (client_wixid)`);
      } catch (e) {
        if (!e.message.includes('Duplicate key')) throw e;
      }
      console.log('[sync-client-wixid] Added client_wixid to', table);
      added++;
    }
    console.log('[sync-client-wixid] Done. Added client_wixid to', added, 'tables.');
  } catch (err) {
    console.error('[sync-client-wixid] Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
