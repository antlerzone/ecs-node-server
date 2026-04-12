/**
 * 导入 ownerdetail CSV。0087 后：id = CSV ID；reference 直接写入 _id 列，无效则 null。
 * 用法：node scripts/import-ownerdetail.js [csv_path]
 * 默认 csv_path = ./ownerdetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn, bukkuAccountFromContactId } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'ownerdetail.csv');
const table = 'ownerdetail';

const CSV_TO_DB = {
  _id: 'id',
  ID: 'id',
  id: 'id',
  'Owner Name': 'ownername',
  ownerName: 'ownername',
  bankName: 'bankname_id',
  'Bank Name': 'bankname_id',
  bankAccount: 'bankaccount',
  email: 'email',
  nric: 'nric',
  signature: 'signature',
  nricFront: 'nricfront',
  nricback: 'nricback',
  accountholder: 'accountholder',
  mobileNumber: 'mobilenumber',
  Mobilenumber: 'mobilenumber',
  status: 'status',
  approvalpending: 'approvalpending',
  Approvalpending: 'approvalpending',
  client: 'client_ref',
  property: 'property_ref',
  profile: 'profile',
  account: 'account',
  contact_id: 'contact_id',
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
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
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
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
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
    console.error('Usage: node scripts/import-ownerdetail.js [csv_path]');
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

  const [clientRows, propertyRows, bankRows] = await Promise.all([
    conn.query('SELECT id FROM operatordetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM propertydetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM bankdetail').then(([r]) => r.map(x => x.id)),
  ]);
  const validClientIds = new Set(clientRows);
  const validPropertyIds = new Set(propertyRows);
  const validBankIds = new Set(bankRows);

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
      if (row.client_ref != null) row.client_ref = stripBrackets(String(row.client_ref)) || null;
      if (row.property_ref != null) row.property_ref = stripBrackets(String(row.property_ref)) || null;
      if (row.bankname_id != null) row.bankname_id = stripBrackets(String(row.bankname_id)) || null;
      if (row.client_ref != null && !validClientIds.has(row.client_ref)) row.client_ref = null;
      if (row.property_ref != null && !validPropertyIds.has(row.property_ref)) row.property_ref = null;
      if (row.bankname_id != null && !validBankIds.has(row.bankname_id)) row.bankname_id = null;

      // contact_id → account JSON（Bukku）；固定 operator
      const acct = bukkuAccountFromContactId(row.contact_id, ONBOARD_OPERATOR_ID);
      if (acct) row.account = acct;
      const clientRef = row.client_ref || null;
      const propertyRef = row.property_ref || null;
      delete row.client_ref;
      delete row.property_ref;

      if (tableColumns.has('client_id')) row.client_id = ONBOARD_OPERATOR_ID;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;

      const hasData = [row.id, row.ownername, row.email].some(
        v => v !== null && v !== undefined && String(v).trim() !== ''
      );
      if (!hasData) continue;

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;

      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${colsList}) VALUES (${placeholders})`;
      await conn.query(sql, keys.map(k => row[k]));
      try {
        await conn.query(
          'INSERT IGNORE INTO owner_client (id, owner_id, client_id, created_at) VALUES (UUID(), ?, ?, NOW())',
          [row.id, ONBOARD_OPERATOR_ID]
        );
      } catch (_) { /* owner_client */ }
      if (propertyRef) {
        try {
          await conn.query(
            'INSERT IGNORE INTO owner_property (id, owner_id, property_id, created_at) VALUES (UUID(), ?, ?, NOW())',
            [row.id, propertyRef]
          );
        } catch (_) { /* owner_property may not exist on older schemas */ }
        await conn.query(
          'UPDATE propertydetail SET owner_id = ?, updated_at = NOW() WHERE id = ?',
          [row.id, propertyRef]
        );
      }
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
