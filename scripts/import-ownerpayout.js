/**
 * Import ownerpayout CSV: property -> property_wixid/property_id, client -> client_id (operatordetail).
 * Usage: node scripts/import-ownerpayout.js [csv_path], default ./OwnerPayout.csv
 * IMPORT_OWNERPAYOUT_CLIENT_ID=<uuid>: force every row's client_id (overrides CSV).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId, UUID_REGEX } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'ownerpayout.csv');
const table = 'ownerpayout';

const CSV_TO_DB = {
  _id: 'id',
  ID: 'id',
  id: 'id',
  property: 'property_id',
  Property: 'property_id',
  period: 'period',
  Period: 'period',
  title: 'title',
  Title: 'title',
  totalrental: 'totalrental',
  totalutility: 'totalutility',
  totalcollection: 'totalcollection',
  expenses: 'expenses',
  netpayout: 'netpayout',
  Bukkubills: 'bukkubills',
  Bukkuinvoice: 'bukkuinvoice',
  monthlyreport: 'monthlyreport',
  client: 'client_id',
  Client: 'client_id',
  CLIENT: 'client_id',
  paid: 'paid',
  Paid: 'paid',
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
    if (c === '"') { inQuotes = !inQuotes; continue; }
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

  const [clientRows] = await conn.query('SELECT id FROM operatordetail');
  const validClientIds = new Set(clientRows.map((x) => x.id));

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
      if (row.property_id != null) row.property_id = stripBrackets(String(row.property_id)) || null;
      if (row.client_id != null) row.client_id = stripBrackets(String(row.client_id)) || null;
      const csvClient = row.client_id != null ? String(row.client_id).trim() : '';
      const forceCid = (process.env.IMPORT_OWNERPAYOUT_CLIENT_ID || '').trim();
      if (forceCid && UUID_REGEX.test(forceCid) && validClientIds.has(forceCid)) {
        row.client_id = forceCid;
      } else if (csvClient && validClientIds.has(csvClient)) {
        row.client_id = csvClient;
      } else if (validClientIds.has(ONBOARD_OPERATOR_ID)) {
        row.client_id = ONBOARD_OPERATOR_ID;
      } else {
        row.client_id = null;
      }
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.paid === null || row.paid === undefined) row.paid = 0;
      const hasData = [row.id, row.title, row.period].some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) continue;
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
