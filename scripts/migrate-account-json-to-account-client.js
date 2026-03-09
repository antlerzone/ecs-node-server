/**
 * 將 account.account_json 裡的 client 對應遷移到 account_client。
 * account_json 為 JSON 陣列，每項 { clientId/client_id, system, accountid, productId }。
 * clientId/client_id 可能是 clientdetail.id 或 clientdetail.wix_id，會先以 id 查再以 wix_id 查。
 * 執行：node scripts/migrate-account-json-to-account-client.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
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

  const [accountRows] = await conn.query(
    "SELECT id, account_json FROM account WHERE account_json IS NOT NULL AND TRIM(account_json) != '' AND account_json != '[]'"
  );

  let inserted = 0;
  let skipped = 0;
  let duplicate = 0;

  for (const row of accountRows) {
    const accountId = row.id;
    const arr = parseJson(row.account_json);
    if (!Array.isArray(arr) || arr.length === 0) continue;

    for (const entry of arr) {
      const clientKey = entry.client_id != null ? entry.client_id : entry.clientId;
      const system = entry.system || entry.provider;
      const accountid = entry.accountid || entry.accountId;
      if (!clientKey || !system || !accountid || String(accountid).trim() === '') {
        skipped++;
        continue;
      }
      const clientKeyStr = String(clientKey).trim();

      const [[byId]] = await conn.query('SELECT id FROM clientdetail WHERE id = ? LIMIT 1', [clientKeyStr]);
      let clientId = byId ? byId.id : null;
      if (!clientId) {
        const [[byWix]] = await conn.query('SELECT id FROM clientdetail WHERE wix_id = ? LIMIT 1', [clientKeyStr]);
        clientId = byWix ? byWix.id : null;
      }
      if (!clientId) {
        skipped++;
        continue;
      }

      const productId = entry.productId != null ? String(entry.productId).trim() : null;
      const systemNorm = String(system).trim().toLowerCase();

      try {
        const [r] = await conn.query(
          `INSERT INTO account_client (account_id, client_id, \`system\`, accountid, product_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = NOW()`,
          [accountId, clientId, systemNorm, String(accountid).trim(), productId]
        );
        if (r.affectedRows === 1) inserted++;
        else if (r.affectedRows === 2) duplicate++;
      } catch (e) {
        console.warn('[migrate] skip', accountId, clientId, systemNorm, e.message);
        skipped++;
      }
    }
  }

  console.log('[migrate-account-json-to-account-client] done. inserted:', inserted, 'updated (duplicate key):', duplicate, 'skipped:', skipped);
  await conn.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
