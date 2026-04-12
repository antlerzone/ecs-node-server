/**
 * 导入 Wix bukkuid（account）CSV：按 title **映射到已有 canonical account.id**（0156/0157），只维护 account_client（Bukku accountid/product）。
 * 不在 account 表为「已有模板科目」新建重复行（例如 Management Fees 应用 a1b2c3d4-0002-… 而非 Wix 行 id）。
 * 仅当 title 无法映射到 canonical 时，才用 CSV 的 ID 插入 account（少见自定义科目）。
 * Usage: node scripts/import-account.js [csv_path]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');
const { canonicalAccountIdForWixTitle, normalizeWixAccountTitle } = require('./lib/account-canonical-map');
const { ensureCanonicalAccounts } = require('./lib/ensure-canonical-accounts');

const csvPath = process.argv[2] || path.join(process.cwd(), 'bukkuid.csv');
const table = 'account';

const CSV_TO_DB = {
  _id: 'id', ID: 'id', id: 'id',
  title: 'title', Title: 'title',
  type: 'wix_item_kind', Type: 'wix_item_kind',
  bukkuaccounttype: 'type', Bukkuaccounttype: 'type',
  Account: 'account_json', account: 'account_json', account_json: 'account_json',
  accountid: 'accountid', accountId: 'accountid',
  productid: 'productid', productId: 'productid',
  client: 'client_json_raw', Client: 'client_json_raw',
  _createdDate: 'created_at', _updatedDate: 'updated_at',
  'Created Date': 'created_at', 'Updated Date': 'updated_at',
};

function splitCsvRows(c) {
  const rows = []; let cur = ''; let q = false;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '"') { q = !q; cur += c[i]; continue; }
    if (!q && (c[i] === '\n' || c[i] === '\r')) {
      if (cur.trim()) rows.push(cur);
      cur = ''; if (c[i] === '\r' && c[i + 1] === '\n') i++;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; continue; }
      q = !q; continue;
    }
    if (!q && line[i] === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += line[i];
  }
  out.push(cur.trim());
  return out;
}

function normalizeVal(val) {
  if (val === '' || val == null) return null;
  let s = String(val).trim().replace(/^'+|'+$/g, '');
  if (!s) return null;
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s))
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  return s;
}

function firstClientIdFromJson(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  try {
    const arr = JSON.parse(s.replace(/""/g, '"'));
    if (Array.isArray(arr) && arr.length > 0) {
      const id = String(arr[0]).replace(/"/g, '').trim();
      return id || null;
    }
  } catch (_) {
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0];
  }
  return null;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) { console.error('File not found:', fullPath); process.exit(1); }
  const lines = splitCsvRows(fs.readFileSync(fullPath, 'utf8'));
  if (lines.length < 2) { console.error('CSV needs header + data.'); process.exit(1); }
  const rawHeaders = parseCsvLine(lines[0]).map((h) => (h || '').replace(/^\uFEFF/, '').trim());
  const headerToDb = (h) => {
    const t = (h || '').trim();
    const k = CSV_TO_DB[t] || CSV_TO_DB[t.replace(/_date$/i, 'Date')] || t;
    return String(k).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, charset: 'utf8mb4',
  });
  const ensured = await ensureCanonicalAccounts(conn);
  if (ensured) console.log('Ensured missing canonical account template row(s):', ensured);

  const dbName = process.env.DB_NAME;
  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map((c) => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [opRows] = await conn.query('SELECT id FROM operatordetail');
  const validOperatorIds = new Set(opRows.map((r) => r.id));

  const usedIds = new Set();
  let inserted = 0;
  let updated = 0;
  let canonicalOnly = 0;
  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb(h);
        if (dbKey === '_owner') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      row.id = resolveId(row, usedIds);

      const wixKind = row.wix_item_kind;
      delete row.wix_item_kind;
      row.is_product = String(wixKind || '').toLowerCase().trim() === 'product' ? 1 : 0;

      if (row.uses_platform_collection_gl === null || row.uses_platform_collection_gl === undefined) {
        row.uses_platform_collection_gl = 0;
      }

      const cid = firstClientIdFromJson(row.client_json_raw);
      delete row.client_json_raw;
      if (cid && validOperatorIds.has(cid)) row.client_id = cid;
      else row.client_id = ONBOARD_OPERATOR_ID;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;

      if (row.account_json != null && typeof row.account_json === 'string' && row.account_json.trim()) {
        try { JSON.parse(row.account_json); } catch (e) { row.account_json = null; }
      }

      const bukkuAccountId = row.accountid != null ? String(row.accountid).trim() || null : null;
      const bukkuProductId = row.productid != null ? String(row.productid).trim() || null : null;

      const titleForMap = normalizeWixAccountTitle(row.title) || row.title;
      const canonicalId = canonicalAccountIdForWixTitle(titleForMap);

      const hasData = [row.id, row.title, row.type, row.account_json].some(
        (v) => v != null && String(v).trim() !== ''
      );
      if (!hasData) continue;

      if (canonicalId) {
        await conn.query(
          'INSERT INTO account_client (account_id, client_id, `system`, accountid, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = VALUES(updated_at)',
          [canonicalId, row.client_id, 'bukku', bukkuAccountId, bukkuProductId, row.created_at, row.updated_at]
        );
        canonicalOnly++;
        continue;
      }

      delete row.accountid;
      delete row.productid;

      const keys = Object.keys(row).filter((k) => tableColumns.has(k.toLowerCase()));
      if (!keys.length) continue;

      const colsList = keys.map((k) => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const updates = keys
        .filter((k) => k.toLowerCase() !== 'id')
        .map((k) => '`' + k + '`=VALUES(`' + k + '`)')
        .join(', ');
      const sql =
        'INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')' +
        (updates ? ' ON DUPLICATE KEY UPDATE ' + updates : '');
      const [res] = await conn.query(sql, keys.map((k) => row[k]));
      if (res.affectedRows === 1) inserted++;
      else if (res.affectedRows === 2) updated++;

      await conn.query(
        'INSERT INTO account_client (account_id, client_id, `system`, accountid, product_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = VALUES(updated_at)',
        [row.id, row.client_id, 'bukku', bukkuAccountId, bukkuProductId, row.created_at, row.updated_at]
      );
    }
    console.log('Done. Mapped to canonical (account_client only):', canonicalOnly, '| account rows inserted:', inserted, 'updated:', updated);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
