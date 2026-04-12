/**
 * Import tenancy CSV: tenant, room, submitby, client -> _wixid/_id.
 * Usage: node scripts/import-tenancy.js [csv_path], default ./Tenancy.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'Tenancy.csv');
const table = 'tenancy';

const CSV_TO_DB = {
  _id: 'id',
  ID: 'id',
  id: 'id',
  tenant: 'tenant_id',
  Tenant: 'tenant_id',
  room: 'room_id',
  Room: 'room_id',
  begin: 'begin',
  Begin: 'begin',
  end: 'end',
  End: 'end',
  rental: 'rental',
  Rental: 'rental',
  submitby: 'submitby_id',
  Submitby: 'submitby_id',
  title: 'title',
  Title: 'title',
  billurl: 'billsurl',
  Billurl: 'billsurl',
  billsurl: 'billsurl',
  billsid: 'billsid',
  Billsid: 'billsid',
  Password: 'password',
  password: 'password',
  status: 'status',
  Status: 'status',
  passwordid: 'passwordid',
  Passwordid: 'passwordid',
  agreement: 'agreement',
  Agreement: 'agreement',
  Signagreement: 'signagreement',
  signagreement: 'signagreement',
  Checkbox: 'checkbox',
  checkbox: 'checkbox',
  Sign: 'sign',
  sign: 'sign',
  Avialabledate: 'availabledate',
  availabledate: 'availabledate',
  Remark: 'remark',
  remark: 'remark',
  Payment: 'payment',
  payment: 'payment',
  client: 'client_id',
  Client: 'client_id',
  CLIENT: 'client_id',
  _createdDate: 'created_at',
  _updatedDate: 'updated_at',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
};

function splitCsvRows(content) {
  const rows = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') { inQuotes = !inQuotes; cur += c; continue; }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (cur.trim().length > 0) rows.push(cur);
      cur = ''; if (c === '\r' && content[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) rows.push(cur);
  return rows;
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeVal(val) {
  if (val === '' || val === null || val === undefined) return null;
  let s = String(val).trim().replace(/^'+|'+$/g, '');
  if (s === '') return null;
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s))
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  return s;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    process.exit(1);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = splitCsvRows(content);
  if (lines.length < 2) { console.error('CSV needs header + data.'); process.exit(1); }
  const rawHeaders = parseCsvLine(lines[0]);
  const headerToDb = (h) => {
    const trimmed = (h || '').trim();
    const key = CSV_TO_DB[trimmed] || CSV_TO_DB[trimmed.replace(/_date$/i, 'Date')] || trimmed;
    return String(key).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

  function stripBrackets(s) {
    if (s == null || typeof s !== 'string') return s;
    return String(s).trim().replace(/^\[|\]$/g, '').replace(/"/g, '').trim();
  }

  const datetimeRegex = /^\d{4}-\d{2}-\d{2}([T\s][\d.:]+Z?)?$/i;
  function sanitizeDatetime(val) {
    if (val == null || val === '') return null;
    const s = String(val).trim();
    if (!datetimeRegex.test(s)) return null;
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  }

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

  const [[t], [r], [s], [c]] = await Promise.all([
    conn.query('SELECT id FROM tenantdetail').then(([rows]) => [rows.map(x => x.id)]),
    conn.query('SELECT id FROM roomdetail').then(([rows]) => [rows.map(x => x.id)]),
    conn.query('SELECT id FROM staffdetail').then(([rows]) => [rows.map(x => x.id)]),
    conn.query('SELECT id FROM operatordetail').then(([rows]) => [rows.map(x => x.id)]),
  ]);
  const validTenantIds = new Set(t);
  const validRoomIds = new Set(r);
  const validStaffIds = new Set(s);
  const validClientIds = new Set(c);

  const usedIds = new Set();
  let inserted = 0;
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
      if (row.tenant_id != null) row.tenant_id = stripBrackets(String(row.tenant_id)) || null;
      if (row.room_id != null) row.room_id = stripBrackets(String(row.room_id)) || null;
      if (row.submitby_id != null) row.submitby_id = stripBrackets(String(row.submitby_id)) || null;
      if (row.client_id != null) row.client_id = stripBrackets(String(row.client_id)) || null;
      if (row.tenant_id != null && !validTenantIds.has(row.tenant_id)) row.tenant_id = null;
      if (row.room_id != null && !validRoomIds.has(row.room_id)) row.room_id = null;
      if (row.submitby_id != null && !validStaffIds.has(row.submitby_id)) row.submitby_id = null;
      if (row.client_id != null && !validClientIds.has(row.client_id)) row.client_id = null;
      row.client_id = ONBOARD_OPERATOR_ID;
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      row.created_at = sanitizeDatetime(row.created_at) || now;
      row.updated_at = sanitizeDatetime(row.updated_at) || now;
      const tinyint01 = (v, def) => { const n = parseInt(String(v || ''), 10); return (n === 0 || n === 1) ? n : def; };
      row.signagreement = tinyint01(row.signagreement, 0);
      row.checkbox = tinyint01(row.checkbox, 0);
      row.status = tinyint01(row.status, 1);
      row.payment = tinyint01(row.payment, 0);
      const hasData = [row.id, row.tenant_id, row.room_id, row.begin, row.title].some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) continue;
      if (row.title != null && String(row.title).length > 255) row.title = String(row.title).substring(0, 255);
      if (row.billsurl != null && String(row.billsurl).length > 255) row.billsurl = String(row.billsurl).substring(0, 255);
      if (row.billsid != null && String(row.billsid).length > 100) row.billsid = String(row.billsid).substring(0, 100);
      if (row.rental != null && row.rental !== '') {
        const n = parseFloat(String(row.rental).trim());
        if (Number.isNaN(n)) row.rental = null; else row.rental = n;
      }
      if (row.begin != null || row.end != null) {
        row.begin = sanitizeDatetime(row.begin);
        row.end = sanitizeDatetime(row.end);
      }
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;
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
