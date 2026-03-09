/**
 * Import meterdetail CSV. room, property, client, parentmeter -> _wixid/_id. Childmeter/Metersharing -> json.
 * Usage: node scripts/import-meterdetail.js [path], default ./meterdetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'meterdetail.csv');
const table = 'meterdetail';

const CSV_TO_DB = {
  _id: 'wix_id', ID: 'wix_id', id: 'wix_id',
  meterId: 'meterid', meterid: 'meterid',
  room: 'room_wixid', Room: 'room_wixid', room_wixid: 'room_wixid',
  property: 'property_wixid', Property: 'property_wixid', property_wixid: 'property_wixid',
  mode: 'mode', balance: 'balance', rate: 'rate',
  lastSyncAt: 'lastsyncat', lastsyncat: 'lastsyncat',
  title: 'title', Title: 'title',
  Customname: 'customname', customname: 'customname',
  Productname: 'productname', productname: 'productname',
  Isonline: 'isonline', isonline: 'isonline',
  Status: 'status', status: 'status',
  client: 'client_wixid', Client: 'client_wixid', CLIENT: 'client_wixid', client_wixid: 'client_wixid',
  Childmeter: 'childmeter_json', childmeter_json: 'childmeter_json',
  Parentmeter: 'parentmeter_wixid', parentmeter_wixid: 'parentmeter_wixid',
  Metersharing: 'metersharing_json', metersharing_json: 'metersharing_json',
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
  const rawHeaders = parseCsvLine(lines[0]);
  const headerToDb = (h) => {
    const t = (h || '').trim();
    const k = CSV_TO_DB[t] || CSV_TO_DB[t.replace(/_date$/i, 'Date')] || t;
    let col = (k === '_id' ? 'wix_id' : k).toLowerCase().replace(/^\s+|\s+$/g, '');
    if (t.toLowerCase() === 'client') col = 'client_wixid';
    if (t.toLowerCase() === 'room') col = 'room_wixid';
    if (t.toLowerCase() === 'property') col = 'property_wixid';
    if (t.toLowerCase() === 'parentmeter') col = 'parentmeter_wixid';
    if (t.toLowerCase() === 'childmeter') col = 'childmeter_json';
    if (t.toLowerCase() === 'metersharing') col = 'metersharing_json';
    if (t.toLowerCase() === 'lastsyncat') col = 'lastsyncat';
    if (t.toLowerCase() === 'customname') col = 'customname';
    if (t.toLowerCase() === 'productname') col = 'productname';
    if (t.toLowerCase() === 'isonline') col = 'isonline';
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

  async function loadMap(tbl) {
    const [r] = await conn.query('SELECT id, wix_id FROM ' + tbl + ' WHERE wix_id IS NOT NULL');
    return new Map(r.map(x => [x.wix_id, x.id]));
  }
  function resolve(map, wixId) {
    if (!wixId) return null;
    const s = String(wixId).trim();
    return map.get(s) || map.get(s.replace(/^!/, '')) || null;
  }
  const roomMap = await loadMap('roomdetail');
  const propertyMap = await loadMap('propertydetail');
  const clientMap = await loadMap('clientdetail');
  const meterMap = await loadMap('meterdetail');

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
      if (row.isonline === null || row.isonline === undefined) row.isonline = 0;
      if (row.status === null || row.status === undefined) row.status = 1;
      if (row.room_wixid) row.room_id = resolve(roomMap, row.room_wixid);
      if (row.property_wixid) row.property_id = resolve(propertyMap, row.property_wixid);
      if (row.client_wixid) row.client_id = resolve(clientMap, row.client_wixid);
      if (row.parentmeter_wixid) row.parentmeter_id = resolve(meterMap, row.parentmeter_wixid);
      for (const key of ['childmeter_json', 'metersharing_json']) {
        if (row[key] != null && typeof row[key] === 'string' && row[key].trim()) {
          try { JSON.parse(row[key]); } catch (e) { row[key] = null; }
        }
      }
      const hasData = [row.wix_id, row.meterid, row.title].some(v => v != null && String(v).trim() !== '');
      if (!hasData) continue;
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (!keys.length) continue;
      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      await conn.query('INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')', keys.map(k => row[k]));
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
