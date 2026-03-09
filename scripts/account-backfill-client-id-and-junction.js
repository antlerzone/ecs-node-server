/**
 * 1) 第一层 junction：用 account.client_wixid 回填 account.client_id（clientdetail.wix_id → clientdetail.id）
 * 2) 第二层：用 account.account_json 回填 account_client，其中 clientId/wix_id 解析为 client_id 再写入
 * 全部使用列名 client_id，不用 client。
 * ECS 执行: cd /home/ecs-user/app && node scripts/account-backfill-client-id-and-junction.js
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

function normalizeWixId(v) {
  if (v == null || typeof v !== 'string') return null;
  const s = String(v)
    .replace(/^\[|\]$/g, '')
    .replace(/"/g, '')
    .trim();
  const first = s.split(',')[0].trim();
  return first || null;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  console.log('Step 1: Backfill account.client_id from account.client_wixid ...');
  const [accountRows] = await conn.query(
    'SELECT id, client_wixid FROM account WHERE client_wixid IS NOT NULL AND TRIM(client_wixid) != ""'
  );
  const [clientRows] = await conn.query('SELECT id, wix_id FROM clientdetail WHERE wix_id IS NOT NULL');
  const wixIdToId = new Map(clientRows.map((r) => [String(r.wix_id).trim(), r.id]));

  let step1Updated = 0;
  for (const row of accountRows) {
    const wixId = normalizeWixId(row.client_wixid);
    if (!wixId) continue;
    const client_id = wixIdToId.get(wixId);
    if (!client_id) continue;
    const [res] = await conn.query('UPDATE account SET client_id = ? WHERE id = ?', [client_id, row.id]);
    if (res.affectedRows) step1Updated++;
  }
  console.log('Step 1 done. account.client_id updated:', step1Updated);

  try {
    await conn.query('SELECT 1 FROM account_client LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') {
      console.log('account_client table not found. Run migration 0052_account_client_junction.sql first, then run this script again.');
      await conn.end();
      return;
    }
    throw e;
  }

  console.log('Step 2: Backfill account_client from account_json (clientId/wix_id -> client_id) ...');
  const idByWixId = new Map();
  for (const r of clientRows) {
    if (r.id) idByWixId.set(r.id, r.id);
    if (r.wix_id) idByWixId.set(String(r.wix_id).trim(), r.id);
  }
  const resolveClientId = (clientIdOrWixId) => {
    if (!clientIdOrWixId) return null;
    return idByWixId.get(String(clientIdOrWixId).trim()) || null;
  };

  const [rows] = await conn.query('SELECT id, account_json FROM account');
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const accountId = row.id;
    const arr = parseJson(row.account_json);
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const a of arr) {
      if (!a || (!a.accountid && !a.accountId)) continue;
      const client_id = a.client_id || resolveClientId(a.clientId) || resolveClientId(a.client_id);
      if (!client_id) {
        skipped++;
        continue;
      }
      const system = String(a.system || '').trim() || 'bukku';
      const accountid = String(a.accountid || a.accountId || '').trim();
      const product_id = a.productId != null ? String(a.productId) : (a.product_id != null ? String(a.product_id) : null);
      try {
        await conn.query(
          `INSERT INTO account_client (account_id, client_id, \`system\`, accountid, product_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = NOW()`,
          [accountId, client_id, system, accountid || null, product_id || null]
        );
        inserted++;
      } catch (e) {
        if (e.code === 'ER_NO_REFERENCED_ROW_2') skipped++;
        else throw e;
      }
    }
  }
  console.log('Step 2 done. account_client inserted/updated:', inserted, 'Skipped:', skipped);
  await conn.end();
  console.log('All done.');
}

run().catch((e) => { console.error(e); process.exit(1); });
