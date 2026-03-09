/**
 * 导入 rentalcollection CSV（Wix 导出）。
 * - CSV 的 ID/_id 写入列 wix_id；主键 id 用新 UUID。
 * - client_id / property_id / room_id / tenant_id / type_id / tenancy_id 由各表 wix_id 解析填入。
 * 用法：node scripts/import-rentalcollection.js [csv_path]
 * 默认 csv_path = ./rentalcollection.csv
 * 导入前清空表请先跑：node scripts/truncate-rentalcollection.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'rentalcollection.csv');
const table = 'rentalcollection';

// Wix 导出列名 → MySQL 列名。ID/_id 写入 wix_id，主键 id 由脚本生成
const CSV_HEADER_TO_DB = {
  id: 'wix_id',
  _id: 'wix_id',
  title: 'title',
  tenant: 'tenant_wixid',
  room: 'room_wixid',
  property: 'property_wixid',
  type: 'type_wixid',
  client: 'client_wixid',
  tenancy: 'tenancy_wix_id',
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
  wix_id: 'wix_id',
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

  // 各表 wix_id → id，用于把 *_wixid 解析为 *_id
  async function loadWixIdMap(refTable) {
    const [rows] = await conn.query(
      'SELECT id, wix_id FROM ' + refTable + ' WHERE wix_id IS NOT NULL AND TRIM(wix_id) != ""'
    );
    const byWixId = new Map();
    for (const r of rows) {
      const w = stripBrackets(r.wix_id);
      if (w) byWixId.set(w, r.id);
    }
    return byWixId;
  }
  const clientMap = await loadWixIdMap('clientdetail');
  const propertyMap = await loadWixIdMap('propertydetail');
  const roomMap = await loadWixIdMap('roomdetail');
  const tenantMap = await loadWixIdMap('tenantdetail');
  const typeMap = await loadWixIdMap('account');
  const tenancyMap = await loadWixIdMap('tenancy');

  let inserted = 0;
  let skipped = 0;

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        const dbKey = headerToDb(h);
        if (!dbKey) return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      const wixIdFromCsv = row.wix_id != null ? String(row.wix_id).trim() : '';
      if (!wixIdFromCsv) {
        skipped++;
        continue;
      }

      row.id = randomUUID();
      row.wix_id = stripBrackets(wixIdFromCsv) || wixIdFromCsv;

      if (row.client_wixid) row.client_id = clientMap.get(stripBrackets(row.client_wixid)) || null;
      if (row.property_wixid) row.property_id = propertyMap.get(stripBrackets(row.property_wixid)) || null;
      if (row.room_wixid) row.room_id = roomMap.get(stripBrackets(row.room_wixid)) || null;
      if (row.tenant_wixid) row.tenant_id = tenantMap.get(stripBrackets(row.tenant_wixid)) || null;
      if (row.type_wixid) row.type_id = typeMap.get(stripBrackets(row.type_wixid)) || null;
      if (row.tenancy_wix_id) row.tenancy_id = tenancyMap.get(stripBrackets(row.tenancy_wix_id)) || null;

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
    console.log('wix_id = CSV ID; id = new UUID; client_id/property_id/room_id/tenant_id/type_id/tenancy_id resolved from *_wixid via tables.');
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
