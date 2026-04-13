/**
 * Import meterdetail CSV。0087 后：id = CSV ID；room/property/client/parentmeter 直接写入 _id 列，无效则 null。
 * Usage:
 *   node scripts/import-meterdetail.js [path/to/meterdetail.csv] [--truncate]
 *   default path: ./meterdetail.csv
 * --truncate: SET FOREIGN_KEY_CHECKS=0; TRUNCATE meterdetail; then import (orphan FKs elsewhere — same UUIDs restore links).
 * FORCE_ONBOARD_CLIENT=1: if CSV client_id not in operatordetail, fall back to ONBOARD_OPERATOR_ID (onboard-only flows).
 * IMPORT_METERDETAIL_CLIENT_ID=<uuid>: force every row's client_id to this operatordetail id (overrides CSV).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId, UUID_REGEX } = require('./import-util');
const { ONBOARD_OPERATOR_ID, skipCsvColumn } = require('./onboard-import-helpers');

const argv = process.argv.slice(2);
const truncateFirst = argv.includes('--truncate');
const pathArg = argv.find((a) => a !== '--truncate');
const csvPath = pathArg || path.join(process.cwd(), 'meterdetail.csv');
const table = 'meterdetail';

const CSV_TO_DB = {
  _id: 'id', ID: 'id', id: 'id',
  meterId: 'meterid', meterid: 'meterid',
  cnyiotmeterid: 'cnyiotmeterid',
  room: 'room_id', Room: 'room_id',
  property: 'property_id', Property: 'property_id',
  mode: 'mode', balance: 'balance', rate: 'rate',
  lastSyncAt: 'lastsyncat', lastsyncat: 'lastsyncat',
  title: 'title', Title: 'title',
  Customname: 'customname', customname: 'customname',
  Productname: 'productname', productname: 'productname',
  Isonline: 'isonline', isonline: 'isonline',
  Status: 'status', status: 'status',
  client: 'client_id', Client: 'client_id', CLIENT: 'client_id',
  Childmeter: 'childmeter_json', childmeter_json: 'childmeter_json',
  Parentmeter: 'parentmeter_id', parentmeter_id: 'parentmeter_id',
  Metersharing: 'metersharing_json', metersharing_json: 'metersharing_json',
  _createdDate: 'created_at', _updatedDate: 'updated_at', 'Created Date': 'created_at', 'Updated Date': 'updated_at',
};

function splitCsvRows(c) {
  const rows = []; let cur = ''; let q = false;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '"') { q = !q; cur += c[i]; continue; }
    if (!q && (c[i] === '\n' || c[i] === '\r')) {
      if (cur.trim()) rows.push(cur);
      cur = ''; if (c[i] === '\r' && c[i + 1] === '\n') i++;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; continue; }
      q = !q; continue;
    }
    if (!q && line[i] === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += line[i];
  }
  out.push(cur.trim());
  return out;
}

function normalizeVal(val) {
  if (val === '' || val == null) return null;
  let s = String(val).trim().replace(/^'+|'+$/g, '');
  if (!s) return null;
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s))
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  return s;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) { console.error('File not found:', fullPath); process.exit(1); }
  const lines = splitCsvRows(fs.readFileSync(fullPath, 'utf8'));
  if (lines.length < 2) { console.error('CSV needs header + data.'); process.exit(1); }
  const rawHeaders = parseCsvLine(lines[0]);
  const headerToDb = (h) => {
    const t = (h || '').trim().replace(/^"|"$/g, '');
    const k = CSV_TO_DB[t] || CSV_TO_DB[t.replace(/_date$/i, 'Date')] || t;
    return String(k).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

  function stripBrackets(s) {
    if (s == null || typeof s !== 'string') return s;
    return String(s).trim().replace(/^\[|\]$/g, '').replace(/"/g, '').trim();
  }

  const idColIdx = rawHeaders.findIndex((h) => headerToDb((h || '').replace(/^"|"$/g, '')) === 'id');
  const csvMeterIds = new Set();
  if (idColIdx >= 0) {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const vid = values[idColIdx] !== undefined ? normalizeVal(values[idColIdx]) : null;
      if (vid && UUID_REGEX.test(String(vid))) csvMeterIds.add(String(vid).trim());
    }
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });
  const dbName = process.env.DB_NAME;

  if (truncateFirst) {
    console.log('[meterdetail] TRUNCATE (FK checks off) …');
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    await conn.query('TRUNCATE TABLE `' + table + '`');
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    console.log('[meterdetail] Truncate done.');
  }

  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [roomRows, propertyRows, clientRows, meterRows] = await Promise.all([
    conn.query('SELECT id FROM roomdetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM propertydetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM operatordetail').then(([r]) => r.map(x => x.id)),
    conn.query('SELECT id FROM meterdetail').then(([r]) => r.map(x => x.id)),
  ]);
  const validRoomIds = new Set(roomRows);
  const validPropertyIds = new Set(propertyRows);
  const validClientIds = new Set(clientRows);
  const validMeterIds = new Set([...meterRows, ...csvMeterIds]);

  const usedIds = new Set();
  let inserted = 0;
  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        if (skipCsvColumn(h)) return;
        const dbKey = headerToDb((h || '').toString().replace(/^"|"$/g, ''));
        if (dbKey === '_owner') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });
      row.id = resolveId(row, usedIds);
      for (const k of ['room_id', 'property_id', 'client_id', 'parentmeter_id']) {
        if (row[k] != null) row[k] = stripBrackets(String(row[k])) || null;
      }
      if (row.room_id != null && !validRoomIds.has(row.room_id)) row.room_id = null;
      if (row.property_id != null && !validPropertyIds.has(row.property_id)) row.property_id = null;
      const csvClient = row.client_id != null ? String(row.client_id).trim() : '';
      if (csvClient && validClientIds.has(csvClient)) {
        row.client_id = csvClient;
      } else if (process.env.FORCE_ONBOARD_CLIENT === '1' && validClientIds.has(ONBOARD_OPERATOR_ID)) {
        row.client_id = ONBOARD_OPERATOR_ID;
      } else {
        row.client_id = null;
      }
      const forceCid = (process.env.IMPORT_METERDETAIL_CLIENT_ID || '').trim();
      if (forceCid && UUID_REGEX.test(forceCid)) row.client_id = forceCid;
      if (row.parentmeter_id != null && !validMeterIds.has(row.parentmeter_id)) row.parentmeter_id = null;
      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.isonline === null || row.isonline === undefined) row.isonline = 0;
      if (row.status === null || row.status === undefined) row.status = 1;
      for (const key of ['childmeter_json', 'metersharing_json']) {
        if (row[key] != null && typeof row[key] === 'string' && row[key].trim()) {
          try { JSON.parse(row[key]); } catch (e) { row[key] = null; }
        }
      }
      const hasData = [row.id, row.meterid, row.title].some(v => v != null && String(v).trim() !== '');
      if (!hasData) continue;
      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (!keys.length) continue;
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
