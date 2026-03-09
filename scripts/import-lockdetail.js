/**
 * Import lockdetail CSV: gateway -> gateway_wixid/gateway_id, client -> client_wixid/client_id.
 * Usage: node scripts/import-lockdetail.js [csv_path]
 * Default: ./LockDetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'LockDetail.csv');
const table = 'lockdetail';

const CSV_TO_DB = {
  _id: 'wix_id',
  ID: 'wix_id',
  id: 'wix_id',
  gateway: 'gateway_wixid',
  Lockid: 'lockid',
  lockid: 'lockid',
  Lockname: 'lockname',
  lockname: 'lockname',
  Electricquantity: 'electricquantity',
  electricquantity: 'electricquantity',
  Type: 'type',
  type: 'type',
  Hasgateway: 'hasgateway',
  hasgateway: 'hasgateway',
  Lockalias: 'lockalias',
  lockalias: 'lockalias',
  client: 'client_wixid',
  Client: 'client_wixid',
  CLIENT: 'client_wixid',
  client_wixid: 'client_wixid',
  active: 'active',
  Active: 'active',
  Childmeter: 'childmeter',
  childmeter: 'childmeter',
  _createdDate: 'created_at',
  _updatedDate: 'updated_at',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
};

function splitCsvRows(content) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') { inQuotes = !inQuotes; cur += c; continue; }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (cur.trim().length > 0) rows.push(cur);
      cur = '';
      if (c === '\r' && content[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) rows.push(cur);
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeVal(val) {
  if (val === '' || val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s)) {
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  }
  return s;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    console.error('Usage: node scripts/import-lockdetail.js [csv_path]');
    process.exit(1);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = splitCsvRows(content);
  if (lines.length < 2) {
    console.error('CSV needs header + at least one data row.');
    process.exit(1);
  }
  const rawHeaders = parseCsvLine(lines[0]);
  const headerToDb = (h) => {
    const trimmed = (h || '').trim();
    const key = CSV_TO_DB[trimmed] || CSV_TO_DB[trimmed.replace(/_date$/i, 'Date')] || trimmed;
    let dbCol = (key === '_id' ? 'wix_id' : key).toLowerCase().replace(/^\s+|\s+$/g, '');
    if (trimmed.toLowerCase() === 'client') dbCol = 'client_wixid';
    if (trimmed.toLowerCase() === 'gateway') dbCol = 'gateway_wixid';
    return dbCol;
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

  async function loadWixIdMap(refTable) {
    const [rows] = await conn.query('SELECT id, wix_id FROM ' + refTable + ' WHERE wix_id IS NOT NULL');
    return new Map(rows.map(r => [r.wix_id, r.id]));
  }
  const gatewayMap = await loadWixIdMap('gatewaydetail');
  const clientMap = await loadWixIdMap('clientdetail');
  function resolveWixId(map, wixId) {
    if (!wixId) return null;
    const s = String(wixId).trim();
    return map.get(s) || map.get(s.replace(/^!/, '')) || null;
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
      row.id = (() => {
        let uid;
        do { uid = randomUUID(); } while (usedIds.has(uid));
        usedIds.add(uid);
        return uid;
      })();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      const hasData = [row.wix_id, row.lockid, row.lockname].some(
        v => v !== null && v !== undefined && String(v).trim() !== ''
      );
      if (!hasData) continue;
      if (row.gateway_wixid) row.gateway_id = resolveWixId(gatewayMap, row.gateway_wixid);
      if (row.client_wixid) row.client_id = resolveWixId(clientMap, row.client_wixid);
      if (row.hasgateway === null || row.hasgateway === undefined) row.hasgateway = 0;
      if (row.active === null || row.active === undefined) row.active = 1;
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;
      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = 'INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')';
      await conn.query(sql, keys.map(k => row[k]));
      inserted++;
      if (inserted % 100 === 0) console.log('Inserted', inserted, '...');
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
