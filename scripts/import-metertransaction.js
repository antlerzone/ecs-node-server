/**
 * 导入 Meter+Transaction CSV → metertransaction。忽略 Owner、Amount_cents；Amount 用数值列 Amount。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { skipCsvColumn } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'Meter+Transaction.csv');
const table = 'metertransaction';

const CSV_TO_DB = {
  _id: 'id', ID: 'id', id: 'id',
  Title: 'ignore_title',
  Tenancy: 'tenancy_id', tenancy: 'tenancy_id',
  Ispaid: 'ispaid', ispaid: 'ispaid',
  Tenant: 'tenant_id', tenant: 'tenant_id',
  Room: 'ignore_room',
  Referenceid: 'referenceid', referenceid: 'referenceid',
  Status: 'status', status: 'status',
  Failreason: 'failreason', failreason: 'failreason',
  Invoiceid: 'invoiceid', invoiceid: 'invoiceid',
  Bukku_invoice_id: 'bukku_invoice_id', bukku_invoice_id: 'bukku_invoice_id',
  Invoiceurl: 'invoiceurl', invoiceurl: 'invoiceurl',
  property: 'property_id', Property: 'property_id',
  Meter: 'meter', meter: 'meter',
  Meteridx: 'meteridx', meteridx: 'meteridx',
  Amount_cents: 'ignore_cents',
  Amount: 'amount',
  _createdDate: 'created_at', _updatedDate: 'updated_at',
  'Created Date': 'created_at', 'Updated Date': 'updated_at',
};

function splitCsvRows(content) {
  const rows = []; let cur = ''; let inQuotes = false;
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
  const s = String(val).trim();
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s)) {
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  }
  return s;
}

function stripBrackets(s) {
  if (s == null || typeof s !== 'string') return s;
  return String(s).trim().replace(/^\[|\]$/g, '').replace(/"/g, '').trim();
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) { console.error('File not found:', fullPath); process.exit(1); }
  const lines = splitCsvRows(fs.readFileSync(fullPath, 'utf8'));
  if (lines.length < 2) { console.error('CSV needs header + data.'); process.exit(1); }
  const rawHeaders = parseCsvLine(lines[0]);
  const headerToDb = (h) => {
    const trimmed = (h || '').trim();
    const key = CSV_TO_DB[trimmed] || CSV_TO_DB[trimmed.replace(/_date$/i, 'Date')] || trimmed;
    return String(key).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, charset: 'utf8mb4',
  });
  const dbName = process.env.DB_NAME;
  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [[tenancies], [tenants]] = await Promise.all([
    conn.query('SELECT id FROM tenancy'),
    conn.query('SELECT id FROM tenantdetail'),
  ]);
  const validTenancyIds = new Set(tenancies.map(r => r.id));
  const validTenantIds = new Set(tenants.map(r => r.id));

  const usedIds = new Set();
  let inserted = 0;
  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb(h);
        if (dbKey === '_owner' || dbKey.startsWith('ignore_')) return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });
      row.id = resolveId(row, usedIds);
      for (const k of ['tenancy_id', 'tenant_id', 'property_id']) {
        if (row[k] != null) row[k] = stripBrackets(String(row[k])) || null;
      }
      if (row.tenancy_id != null && !validTenancyIds.has(row.tenancy_id)) row.tenancy_id = null;
      if (row.tenant_id != null && !validTenantIds.has(row.tenant_id)) row.tenant_id = null;

      if (row.amount != null && row.amount !== '') {
        const n = parseFloat(String(row.amount).trim());
        row.amount = Number.isNaN(n) ? null : n;
      }

      if (row.bukku_invoice_id != null && row.bukku_invoice_id !== '') {
        const n = parseInt(String(row.bukku_invoice_id).trim(), 10);
        row.bukku_invoice_id = Number.isNaN(n) ? null : n;
      }
      if (row.meteridx != null && row.meteridx !== '') {
        const n = parseInt(String(row.meteridx).trim(), 10);
        row.meteridx = Number.isNaN(n) ? null : n;
      }

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.ispaid === null || row.ispaid === undefined) row.ispaid = 0;

      const hasData = [row.id].some(v => v != null && String(v).trim() !== '');
      if (!hasData) continue;

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;
      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      await conn.query('INSERT INTO `' + table + '` (' + colsList + ') VALUES (' + placeholders + ')', keys.map(k => row[k]));
      inserted++;
      if (inserted % 200 === 0) console.log('Inserted', inserted, '...');
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
