/**
 * 导入 propertydetail CSV。0087 后：id = CSV ID；reference 直接写入 _id 列，无效则 null。
 * 用法：node scripts/import-propertydetail.js [csv_path]
 * 默认 csv_path = ./propertydetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'propertydetail.csv');

const CSV_TO_DB = {
  _id: 'id',
  ID: 'id',
  id: 'id',
  Shortname: 'shortname',
  shortname: 'shortname',
  unitNumber: 'unitnumber',
  'Unit Number': 'unitnumber',
  apartmentName: 'apartmentname',
  'Apartment Name': 'apartmentname',
  agreementtemplate: 'agreementtemplate_id',
  Agreementtemplate: 'agreementtemplate_id',
  client: 'client_id',
  management: 'management_id',
  internetType: 'internettype_id',
  'internet type': 'internettype_id',
  Ownername: 'ownername',
  ownername: 'ownername',
  Owner: 'owner_id',
  'OwnerDetail_property': 'owner_id',
  meter: 'meter_id',
  smartdoor: 'smartdoor_id',
  wifi: 'wifi_id',
  'Parking lot': 'parkinglot',
  saj: 'water',
  tnb: 'electric',
  address: 'address',
  _createdDate: 'created_at',
  _updatedDate: 'updated_at',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
};

/** 按行分割 CSV，但引号内的换行不算新行（避免 wifidetail 等单元格内换行被当成多行） */
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
    console.error('Usage: node scripts/import-propertydetail.js [csv_path]');
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
  const table = 'propertydetail';

  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [clientRows, ownerRows, meterRows, agreementRows, supplierRows, lockRows] = await Promise.all([
    conn.query('SELECT id FROM operatordetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM ownerdetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM meterdetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM agreementtemplate').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM supplierdetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM lockdetail').then(([r]) => r.map(x => x.id)),
  ]);
  const validClientIds = new Set(clientRows);
  const validOwnerIds = new Set(ownerRows);
  const validMeterIds = new Set(meterRows);
  const validAgreementIds = new Set(agreementRows);
  const validSupplierIds = new Set(supplierRows);
  const validLockIds = new Set(lockRows);

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
      for (const k of ['client_id', 'owner_id', 'meter_id', 'agreementtemplate_id', 'management_id', 'internettype_id', 'smartdoor_id']) {
        if (row[k] != null) row[k] = stripBrackets(String(row[k])) || null;
      }
      if (row.client_id != null && !validClientIds.has(row.client_id)) row.client_id = null;
      if (row.owner_id != null && !validOwnerIds.has(row.owner_id)) row.owner_id = null;
      if (row.meter_id != null && !validMeterIds.has(row.meter_id)) row.meter_id = null;
      if (row.agreementtemplate_id != null && !validAgreementIds.has(row.agreementtemplate_id)) row.agreementtemplate_id = null;
      if (row.management_id != null && !validSupplierIds.has(row.management_id)) row.management_id = null;
      if (row.internettype_id != null && !validSupplierIds.has(row.internettype_id)) row.internettype_id = null;
      if (row.smartdoor_id != null && !validLockIds.has(row.smartdoor_id)) row.smartdoor_id = null;
      if (tableColumns.has('client_id')) row.client_id = ONBOARD_OPERATOR_ID;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.checkbox === null || row.checkbox === undefined) row.checkbox = 0;
      if (row.active === null || row.active === undefined) row.active = 1;

      const hasData = [row.id, row.shortname, row.unitnumber, row.address].some(
        v => v !== null && v !== undefined && String(v).trim() !== ''
      );
      if (!hasData) continue;

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;

      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${colsList}) VALUES (${placeholders})`;
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
