/**
 * 导入 propertydetail CSV：列对齐、reference 用 xxx_wixid 上传并解析 xxx_id，boolean true/false -> 1/0。
 * 用法：node scripts/import-propertydetail.js [csv_path]
 * 默认 csv_path = ./propertydetail.csv（文件请放在项目目录并命名为 propertydetail.csv）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const csvPath = process.argv[2] || path.join(process.cwd(), 'propertydetail.csv');

const CSV_TO_DB = {
  _id: 'wix_id',
  unitNumber: 'unitnumber',
  apartmentName: 'apartmentname',
  agreementtemplate: 'agreementtemplate_wixid',
  client: 'client_wixid',
  management: 'management_wixid',
  internetType: 'internettype_wixid',
  ownername: 'owner_wixid',
  meter: 'meter_wixid',
  smartdoor: 'smartdoor_wixid',
  saj: 'water',
  tnb: 'electric',
  _createdDate: 'created_at',
  _updatedDate: 'updated_at',
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
    return (key === '_id' ? 'wix_id' : key).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

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

  async function loadWixIdMap(refTable) {
    const [rows] = await conn.query(
      'SELECT id, wix_id FROM ' + refTable + ' WHERE wix_id IS NOT NULL'
    );
    return new Map(rows.map(r => [r.wix_id, r.id]));
  }

  const clientMap = await loadWixIdMap('clientdetail');
  const meterMap = await loadWixIdMap('meterdetail');
  const agreementMap = await loadWixIdMap('agreementtemplate');
  const supplierMap = await loadWixIdMap('supplierdetail');
  const ownerMap = await loadWixIdMap('ownerdetail');
  const lockMap = await loadWixIdMap('lockdetail');

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

      row.id = (() => {
        let uid;
        do { uid = randomUUID(); } while (usedIds.has(uid));
        usedIds.add(uid);
        return uid;
      })();

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.checkbox === null || row.checkbox === undefined) row.checkbox = 0;
      if (row.active === null || row.active === undefined) row.active = 1;

      const hasData = [row.wix_id, row.shortname, row.unitnumber, row.address].some(
        v => v !== null && v !== undefined && String(v).trim() !== ''
      );
      if (!hasData) continue;

      if (row.client_wixid) row.client_id = clientMap.get(row.client_wixid) || null;
      if (row.meter_wixid) row.meter_id = meterMap.get(row.meter_wixid) || null;
      if (row.agreementtemplate_wixid) row.agreementtemplate_id = agreementMap.get(row.agreementtemplate_wixid) || null;
      if (row.management_wixid) row.management_id = supplierMap.get(row.management_wixid) || null;
      if (row.internettype_wixid) row.internettype_id = supplierMap.get(row.internettype_wixid) || null;
      if (row.owner_wixid) row.owner_id = ownerMap.get(row.owner_wixid) || null;
      if (row.smartdoor_wixid) row.smartdoor_id = lockMap.get(row.smartdoor_wixid) || null;

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
