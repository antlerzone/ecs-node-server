/**
 * 导入 tenantdetail CSV。0087 后：id = CSV _id（不生成）；reference 直接写入 _id 列。
 * 用法：node scripts/import-tenantdetail.js [csv_path]
 * 默认 csv_path = ./tenantdetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn, bukkuAccountFromContactId } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'tenantdetail.csv');
const table = 'tenantdetail';

const CSV_TO_DB = {
  _id: 'id',
  ID: 'id',
  id: 'id',
  Fullname: 'fullname',
  fullname: 'fullname',
  nric: 'nric',
  address: 'address',
  phone: 'phone',
  email: 'email',
  bankName: 'bankname_id',
  bankAccount: 'bankaccount',
  accountholder: 'accountholder',
  nricFront: 'nricfront',
  nricback: 'nricback',
  client: 'client_id',
  contact_id: 'contact_id',
  account: 'account',
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
    console.error('Usage: node scripts/import-tenantdetail.js [csv_path]');
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
    const dbCol = String(key).toLowerCase().replace(/^\s+|\s+$/g, '');
    if (trimmed.toLowerCase() === 'client') return 'client_id';
    return dbCol;
  };

  function stripBrackets(s) {
    if (s == null || typeof s !== 'string') return s;
    return s.trim().replace(/^\[|\]$/g, '').replace(/"/g, '').trim();
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

  const usedIds = new Set();
  let inserted = 0;

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb(h);
        if (dbKey === '_owner' || String(dbKey).toLowerCase() === 'owner') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      row.id = resolveId(row, usedIds);

      row.client_id = ONBOARD_OPERATOR_ID;

      const acct = bukkuAccountFromContactId(row.contact_id, ONBOARD_OPERATOR_ID);
      if (acct) row.account = acct;
      if (row.contact_id != null && row.contact_id !== '') {
        const cn = parseInt(String(row.contact_id).trim(), 10);
        if (!Number.isNaN(cn) && String(cn) === String(row.contact_id).trim()) {
          row.contact_id = cn;
        }
      } else {
        row.contact_id = null;
      }

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;

      const hasData = [row.id, row.fullname, row.email].some(
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
          'INSERT IGNORE INTO tenant_client (tenant_id, client_id, created_at) VALUES (?, ?, NOW())',
          [row.id, ONBOARD_OPERATOR_ID]
        );
      } catch (_) {
        try {
          await conn.query(
            'INSERT IGNORE INTO tenant_client (id, tenant_id, client_id, created_at) VALUES (UUID(), ?, ?, NOW())',
            [row.id, ONBOARD_OPERATOR_ID]
          );
        } catch (_) { /* tenant_client schema variant */ }
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
