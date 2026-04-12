/**
 * 导入 rentalcollection CSV（Wix 导出）。0087 后：id = CSV _id；reference 直接写入 _id 列。
 * 用法：node scripts/import-rentalcollection.js [csv_path] [bukkuid_csv]
 * 默认 csv_path = ./rentalcollection.csv；bukkuid 默认 cleanlemon/next-app/Wix cms/bukkuid (2).csv
 * 导入前清空表请先跑：node scripts/truncate-rentalcollection.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');
const { buildWixAccountIdToCanonicalMap } = require('./lib/account-canonical-map');

const csvPath = process.argv[2] || path.join(process.cwd(), 'rentalcollection.csv');
/** 可选：bukkuid CSV，用于把 Wix type UUID 映射到 canonical account.id */
const bukkuidCsvPath =
  process.argv[3] ||
  path.join(process.cwd(), 'cleanlemon/next-app/Wix cms/bukkuid (2).csv');
const table = 'rentalcollection';

// Wix 导出列名 → MySQL 列名。0087：_id→id；reference 直接→_id 列
const CSV_HEADER_TO_DB = {
  id: 'id',
  _id: 'id',
  title: 'title',
  tenant: 'tenant_id',
  room: 'room_id',
  property: 'property_id',
  type: 'type_id',
  client: 'client_id',
  tenancy: 'tenancy_id',
  date: 'date',
  'created date': 'created_at',
  _createddate: 'created_at',
  'updated date': 'updated_at',
  _updateddate: 'updated_at',
  ispaid: 'ispaid',
  amount: 'amount',
  paidat: 'paidat',
  receipturl: 'receipturl',
  invoiceid: 'invoiceid',
  invoiceurl: 'invoiceurl',
  referenceid: 'referenceid',
  description: 'description',
  bukku_invoice_id: 'bukku_invoice_id',
  accountid: 'accountid',
  productid: 'productid',
};

function stripBrackets(s) {
  if (s == null || typeof s !== 'string') return s;
  return s.trim().replace(/^\[|\]$/g, '').trim();
}

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
    console.error('Usage: node scripts/import-rentalcollection.js [csv_path]');
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
    const lower = trimmed.toLowerCase();
    const withoutWixId = lower.replace(/\s*\(wix\s+id\)\s*$/i, '').trim();
    return CSV_HEADER_TO_DB[lower] || CSV_HEADER_TO_DB[withoutWixId] || CSV_HEADER_TO_DB[trimmed] || lower.replace(/\s+/g, '_').replace(/[()]/g, '');
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

  const [tenancyRows] = await conn.query('SELECT id FROM tenancy');
  const [tenantRows] = await conn.query('SELECT id FROM tenantdetail');
  const [accountRows] = await conn.query('SELECT id FROM account');
  const validTenancyIds = new Set(tenancyRows.map(r => r.id));
  const validTenantIds = new Set(tenantRows.map(r => r.id));
  const validAccountIds = new Set(accountRows.map(r => r.id));

  const wixToCanonical = buildWixAccountIdToCanonicalMap(bukkuidCsvPath);
  console.log('Wix account id → canonical map size:', wixToCanonical.size, 'from', bukkuidCsvPath);

  const usedIds = new Set();
  let inserted = 0;
  let skipped = 0;

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb(h);
        if (!dbKey) return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      row.id = resolveId(row, usedIds);

      const hasData = [row.id, row.client_id, row.property_id, row.tenant_id].some(
        v => v != null && String(v).trim() !== ''
      );
      if (!hasData) {
        skipped++;
        continue;
      }

      const toId = (v) => { const s = stripBrackets(String(v || '')); return s && s.trim() ? s.trim() : null; };
      if (row.client_id != null) row.client_id = toId(row.client_id);
      if (row.property_id != null) row.property_id = toId(row.property_id);
      if (row.room_id != null) row.room_id = toId(row.room_id);
      if (row.tenant_id != null) row.tenant_id = toId(row.tenant_id);
      if (row.type_id != null) row.type_id = toId(row.type_id);
      if (row.type_id != null && wixToCanonical.has(row.type_id)) {
        row.type_id = wixToCanonical.get(row.type_id);
      }
      if (row.tenancy_id != null) row.tenancy_id = toId(row.tenancy_id);
      if (row.tenancy_id != null && !validTenancyIds.has(row.tenancy_id)) row.tenancy_id = null;
      if (row.tenant_id != null && !validTenantIds.has(row.tenant_id)) row.tenant_id = null;
      if (row.type_id != null && !validAccountIds.has(row.type_id)) row.type_id = null;
      row.client_id = ONBOARD_OPERATOR_ID;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (tableColumns.has('created_at') && (row.created_at === null || row.created_at === undefined)) row.created_at = now;
      if (tableColumns.has('updated_at') && (row.updated_at === null || row.updated_at === undefined)) row.updated_at = now;
      if (tableColumns.has('ispaid') && (row.ispaid === null || row.ispaid === undefined)) row.ispaid = 0;

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) {
        skipped++;
        continue;
      }

      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${colsList}) VALUES (${placeholders})`;
      await conn.query(sql, keys.map(k => row[k]));
      inserted++;
      if (inserted % 100 === 0) console.log('Inserted', inserted, '...');
    }
    console.log('Done. Inserted', inserted, 'rows into', table + (skipped ? '; skipped ' + skipped + ' rows.' : '.'));
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
