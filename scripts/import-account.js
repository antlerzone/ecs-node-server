/**
 * Import bukkuid CSV into account. client->client_wixid/client_id (FK); also syncs account_client junction.
 * Usage: node scripts/import-account.js [path], default ./bukkuid.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'bukkuid.csv');
const table = 'account';

const CSV_TO_DB = {
  _id: 'wix_id', ID: 'wix_id', id: 'wix_id',
  title: 'title', Title: 'title',
  type: 'type', Type: 'type',
  client: 'client_wixid', Client: 'client_wixid', CLIENT: 'client_wixid', client_wixid: 'client_wixid',
  Account: 'account_json', account: 'account_json', account_json: 'account_json',
  accountid: 'accountid', accountId: 'accountid', accountID: 'accountid',
  productid: 'productid', productId: 'productid',
  bukkuaccounttype: 'bukkuaccounttype', text: 'bukkuaccounttype',
  _createdDate: 'created_at', _updatedDate: 'updated_at', 'Created Date': 'created_at', 'Updated Date': 'updated_at',
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

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) { console.error('File not found:', fullPath); process.exit(1); }
  const lines = splitCsvRows(fs.readFileSync(fullPath, 'utf8'));
  if (lines.length < 2) { console.error('CSV needs header + data.'); process.exit(1); }
  const rawHeaders = parseCsvLine(lines[0]).map(h => (h || '').replace(/^\uFEFF/, '').trim());
  const headerToDb = (h) => {
    const t = (h || '').trim();
    const k = CSV_TO_DB[t] || CSV_TO_DB[t.replace(/_date$/i, 'Date')] || t;
    let col = (k === '_id' ? 'wix_id' : k).toLowerCase().replace(/^\s+|\s+$/g, '');
    if (t.toLowerCase() === 'client') col = 'client_wixid';
    if (t.toLowerCase() === 'account') col = 'account_json';
    if (t.toLowerCase() === 'id') col = 'wix_id';
    return col;
  };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  const dbName = process.env.DB_NAME;
  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));
  if (tableColumns.size === 0) {
    console.error('Table "account" does not exist. Create it first (e.g. run 0001_init.sql or ensure account table exists).');
    await conn.end();
    process.exit(1);
  }

  const [rows] = await conn.query('SELECT id, wix_id FROM clientdetail WHERE wix_id IS NOT NULL');
  const clientMap = new Map(rows.map(r => [r.wix_id, r.id]));
  function resolveWixId(wixId) {
    if (!wixId) return null;
    const s = String(wixId).trim();
    return clientMap.get(s) || clientMap.get(s.replace(/^!/, '')) || null;
  }

  const usedIds = new Set();
  let inserted = 0;
  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        const dbKey = headerToDb(h);
        if (dbKey === '_owner') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });
      row.id = (() => { let u; do { u = randomUUID(); } while (usedIds.has(u)); usedIds.add(u); return u; })();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.client_wixid) row.client_id = resolveWixId(row.client_wixid);
      if (row.account_json != null && typeof row.account_json === 'string' && row.account_json.trim()) {
        try { JSON.parse(row.account_json); } catch (e) { row.account_json = null; }
      }
      const hasData = [row.wix_id, row.title, row.accountid, row.type, row.bukkuaccounttype, row.client_wixid].some(v => v != null && String(v).trim() !== '');
      if (!hasData) continue;
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (!keys.length) continue;
      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      await conn.query('INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')', keys.map(k => row[k]));
      if (row.client_id) {
        const system = 'bukku';
        await conn.query(
          'INSERT IGNORE INTO account_client (account_id, client_id, system, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [row.id, row.client_id, system, row.created_at || now, row.updated_at || now]
        );
      }
      inserted++;
      if (inserted % 100 === 0) console.log('Inserted', inserted, '...');
    }
    if (inserted === 0 && lines.length > 1) {
      console.warn('No rows inserted. Check CSV has header row 1 with at least one of: ID, title, type, client, Account, accountid, productid, bukkuaccounttype.');
    }
    console.log('Done. Inserted', inserted, 'rows into', table);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
