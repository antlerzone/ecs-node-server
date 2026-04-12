/**
 * Backfill account_client from account.account_json. Run once after 0052_account_client_junction.sql.
 * Usage: node scripts/backfill-account-client.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  const [clientRows] = await conn.query('SELECT id, wix_id FROM operatordetail');
  const idByWixId = new Map();
  for (const r of clientRows) {
    if (r.id) idByWixId.set(r.id, r.id);
    if (r.wix_id) idByWixId.set(String(r.wix_id).trim(), r.id);
  }
  const resolveClientId = (clientIdOrWixId) => {
    if (!clientIdOrWixId) return null;
    return idByWixId.get(String(clientIdOrWixId).trim()) || null;
  };

  const [accountRows] = await conn.query('SELECT id, account_json FROM account');
  let inserted = 0;
  let skipped = 0;
  for (const row of accountRows) {
    const accountId = row.id;
    const arr = parseJson(row.account_json);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const a of arr) {
      if (!a || (!a.accountid && !a.accountId)) continue;
      const clientId = a.client_id || a.clientId || resolveClientId(a.clientId) || resolveClientId(a.client_id);
      if (!clientId) {
        skipped++;
        continue;
      }
      const system = String(a.system || '').trim() || 'bukku';
      const accountid = String(a.accountid || a.accountId || '').trim();
      const productId = a.productId != null ? String(a.productId) : (a.product_id != null ? String(a.product_id) : null);
      try {
        await conn.query(
          `INSERT INTO account_client (account_id, client_id, system, accountid, product_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = NOW()`,
          [accountId, clientId, system, accountid || null, productId || null]
        );
        inserted++;
      } catch (e) {
        if (e.code === 'ER_NO_REFERENCED_ROW_2') skipped++;
        else throw e;
      }
    }
  }
  console.log('account_client backfill done. Inserted/updated:', inserted, 'Skipped (no client_id or FK):', skipped);
  await conn.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
