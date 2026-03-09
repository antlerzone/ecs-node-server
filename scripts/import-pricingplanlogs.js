/**
 * Import pricingplanlogs CSV. Clientid->client_wixid/client_id, Staff->staff_wixid/staff_id, Planid->plan_wixid/plan_id.
 * Usage: node scripts/import-pricingplanlogs.js [path], default ./pricingplanlogs.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'pricingplanlogs.csv');
const table = 'pricingplanlogs';

const CSV_TO_DB = {
  _id: 'wix_id', ID: 'wix_id', id: 'wix_id',
  title: 'title', Title: 'title',
  scenario: 'scenario', Scenario: 'scenario',
  clientid: 'client_wixid', Clientid: 'client_wixid', ClientId: 'client_wixid', client_wixid: 'client_wixid',
  amount: 'amount', Amount: 'amount',
  amountcents: 'amountcents', Amountcents: 'amountcents', AmountCents: 'amountcents',
  status: 'status', Status: 'status',
  staff: 'staff_wixid', Staff: 'staff_wixid', staff_wixid: 'staff_wixid',
  planid: 'plan_wixid', Planid: 'plan_wixid', PlanId: 'plan_wixid', plan_wixid: 'plan_wixid',
  referencenumber: 'referencenumber', Referencenumber: 'referencenumber', ReferenceNumber: 'referencenumber',
  paidat: 'paidat', Paidat: 'paidat', PaidAt: 'paidat',
  payload: 'payload_json', Payload: 'payload_json', payload_json: 'payload_json',
  payexreference: 'payexreference', Payexreference: 'payexreference', PayexReference: 'payexreference',
  txnid: 'txid', Txnid: 'txid', TxnId: 'txid', txid: 'txid',
  addons: 'addons_json', Addons: 'addons_json', addons_json: 'addons_json',
  addondeductamount: 'addondeductamount', Addondeductamount: 'addondeductamount', AddonDeductAmount: 'addondeductamount',
  redirecturl: 'redirecturl', Redirecturl: 'redirecturl', RedirectUrl: 'redirecturl',
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
    if (t.toLowerCase() === 'clientid') col = 'client_wixid';
    if (t.toLowerCase() === 'staff') col = 'staff_wixid';
    if (t.toLowerCase() === 'planid') col = 'plan_wixid';
    if (t.toLowerCase() === 'payload') col = 'payload_json';
    if (t.toLowerCase() === 'addons') col = 'addons_json';
    if (t.toLowerCase() === 'txnid') col = 'txid';
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
    console.error('Table "pricingplanlogs" does not exist.');
    await conn.end();
    process.exit(1);
  }

  async function loadMap(tbl) {
    const [r] = await conn.query('SELECT id, wix_id FROM ' + tbl + ' WHERE wix_id IS NOT NULL');
    return new Map(r.map(x => [x.wix_id, x.id]));
  }
  function resolve(map, wixId) {
    if (!wixId) return null;
    const s = String(wixId).trim();
    return map.get(s) || map.get(s.replace(/^!/, '')) || null;
  }
  const clientMap = await loadMap('clientdetail');
  const staffMap = await loadMap('staffdetail');
  const planMap = await loadMap('pricingplan');

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
      if (row.client_wixid) row.client_id = resolve(clientMap, row.client_wixid);
      if (row.staff_wixid) row.staff_id = resolve(staffMap, row.staff_wixid);
      if (row.plan_wixid) row.plan_id = resolve(planMap, row.plan_wixid);
      for (const key of ['payload_json', 'addons_json']) {
        if (row[key] != null && typeof row[key] === 'string' && row[key].trim()) {
          try { JSON.parse(row[key]); } catch (e) { row[key] = null; }
        }
      }
      const hasData = [row.wix_id, row.title, row.scenario, row.client_wixid, row.amount, row.plan_wixid].some(v => v != null && String(v).trim() !== '');
      if (!hasData) continue;
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (!keys.length) continue;
      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      await conn.query('INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')', keys.map(k => row[k]));
      inserted++;
      if (inserted % 100 === 0) console.log('Inserted', inserted, '...');
    }
    if (inserted === 0 && lines.length > 1) {
      console.warn('No rows inserted. Check CSV headers: title, Scenario, Clientid, Amount, Staff, Planid, etc.');
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
