/**
 * 导入 roomdetail CSV。0087：id = CSV ID；property/meter/smartdoor 为 UUID → *_id；client 固定 onboard。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');

const csvPath = process.argv[2] || path.join(process.cwd(), 'RoomDetail.csv');
const table = 'roomdetail';

const CSV_TO_DB = {
  _id: 'id', ID: 'id', id: 'id',
  Title: 'title_fld', title_fld: 'title_fld',
  Description: 'description_fld', description_fld: 'description_fld',
  Available: 'available', available: 'available',
  'Parking Lot': 'parkinglot', parkinglot: 'parkinglot',
  'Smart Meter': 'smartmeter', 'Smart meter': 'smartmeter', SmartMeter: 'smartmeter', smartmeter: 'smartmeter',
  Price: 'price', price: 'price',
  'Main Photo': 'mainphoto', mainphoto: 'mainphoto',
  'Media Gallery': 'media_gallery_json', media_gallery_json: 'media_gallery_json',
  Remark: 'remark', remark: 'remark',
  Appointment: 'appointment', appointment: 'appointment',
  Property: 'property_id', property: 'property_id',
  'Room Name': 'roomname', roomname: 'roomname',
  meter: 'meter_id', Meter: 'meter_id',
  Availabledate: 'availabledate', availabledate: 'availabledate',
  Availablefrom: 'availablefrom', availablefrom: 'availablefrom',
  availablesoon: 'availablesoon',
  Msg: 'msg', msg: 'msg',
  Status: 'status', status: 'status',
  client: 'ignore_client',
  active: 'active', Active: 'active',
  smartdoor: 'smartdoor_id', Smartdoor: 'smartdoor_id',
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
  const s = String(val).trim();
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s))
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
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

  const [[props], [meters], [locks]] = await Promise.all([
    conn.query('SELECT id FROM propertydetail'),
    conn.query('SELECT id FROM meterdetail'),
    conn.query('SELECT id FROM lockdetail'),
  ]);
  const validPropertyIds = new Set(props.map(r => r.id));
  const validMeterIds = new Set(meters.map(r => r.id));
  const validLockIds = new Set(locks.map(r => r.id));

  const usedIds = new Set();
  let inserted = 0;
  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb(h);
        if (dbKey === '_owner' || dbKey === 'ignore_client') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });
      row.id = resolveId(row, usedIds);
      for (const k of ['property_id', 'meter_id', 'smartdoor_id']) {
        if (row[k] != null) row[k] = stripBrackets(String(row[k])) || null;
      }
      if (row.property_id != null && !validPropertyIds.has(row.property_id)) row.property_id = null;
      if (row.meter_id != null && !validMeterIds.has(row.meter_id)) row.meter_id = null;
      if (row.smartdoor_id != null && !validLockIds.has(row.smartdoor_id)) row.smartdoor_id = null;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.available === null || row.available === undefined) row.available = 0;
      if (row.availablesoon === null || row.availablesoon === undefined) row.availablesoon = 0;
      if (row.active === null || row.active === undefined) row.active = 1;
      row.client_id = ONBOARD_OPERATOR_ID;

      const hasData = [row.id, row.title_fld, row.roomname].some(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasData) continue;

      if (row.smartmeter !== null && row.smartmeter !== undefined) {
        const v = parseInt(row.smartmeter, 10);
        if (Number.isNaN(v) || v < -2147483648 || v > 2147483647) row.smartmeter = null;
        else row.smartmeter = v;
      }
      if (row.media_gallery_json != null && typeof row.media_gallery_json === 'string' && row.media_gallery_json.trim() !== '') {
        try { JSON.parse(row.media_gallery_json); } catch (e) { row.media_gallery_json = null; }
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
