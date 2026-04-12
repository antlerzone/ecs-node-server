/**
 * Import staffdetail CSV: Bank Name -> bankname_wixid/bank_name_id, Client -> client_wixid/client_id.
 * Usage: node scripts/import-staffdetail.js [csv_path], default ./StaffDetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'StaffDetail.csv');
const table = 'staffdetail';

const CSV_TO_DB = {
  _id: 'wix_id',
  ID: 'wix_id',
  id: 'wix_id',
  Name: 'name',
  name: 'name',
  email: 'email',
  salary: 'salary',
  'Bank Name': 'bankname_wixid',
  bankName: 'bankname_wixid',
  bankname_wixid: 'bankname_wixid',
  'Bank Account': 'bankaccount',
  bankAccount: 'bankaccount',
  bankaccount: 'bankaccount',
  Client: 'client_wixid',
  client: 'client_wixid',
  CLIENT: 'client_wixid',
  client_wixid: 'client_wixid',
  status: 'status',
  Status: 'status',
  permission: 'permission_json',
  Permission: 'permission_json',
  permission_json: 'permission_json',
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
    let dbCol = (key === '_id' ? 'wix_id' : key).toLowerCase().replace(/^\s+|\s+$/g, '');
    if (trimmed.toLowerCase() === 'client') dbCol = 'client_wixid';
    if (trimmed.toLowerCase() === 'bank name') dbCol = 'bankname_wixid';
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
  function resolveWixId(map, wixId) {
    if (!wixId) return null;
    const s = String(wixId).trim();
    return map.get(s) || map.get(s.replace(/^!/, '')) || null;
  }
  const bankMap = await loadWixIdMap('bankdetail');
  const clientMap = await loadWixIdMap('operatordetail');

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
      row.id = (() => { let uid; do { uid = randomUUID(); } while (usedIds.has(uid)); usedIds.add(uid); return uid; })();
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.status === null || row.status === undefined) row.status = 1;
      const hasData = [row.wix_id, row.name, row.email].some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) continue;
      if (row.bankname_wixid) row.bank_name_id = resolveWixId(bankMap, row.bankname_wixid);
      if (row.client_wixid) row.client_id = resolveWixId(clientMap, row.client_wixid);
      if (row.permission_json !== null && row.permission_json !== undefined && typeof row.permission_json === 'string' && row.permission_json.trim() !== '') {
        try {
          JSON.parse(row.permission_json);
        } catch (e) {
          row.permission_json = null;
        }
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
