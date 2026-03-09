/**
 * Import CSV into a table: 每行生成自己的 UUID 作为 id，原 _id 写入 wix_id。
 * Usage: node scripts/import-csv-with-uuid.js <table_name> <csv_file_path>
 * Example: node scripts/import-csv-with-uuid.js propertydetail ./propertydetail.csv
 *
 * CSV: 第一行为列名（会转成小写），若列名为 _id 则自动映射到 wix_id；列名 client 映射到 client_wixid，并据 clientdetail.wix_id 解析出 client_id。
 * TRUE/FALSE 会自动转为 1/0。
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const tableName = process.argv[2];
const csvPath = process.argv[3];

if (!tableName || !csvPath) {
  console.error('Usage: node scripts/import-csv-with-uuid.js <table_name> <csv_file_path>');
  process.exit(1);
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
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/i.test(s)) {
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  }
  return s;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    process.exit(1);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) {
    console.error('CSV needs header + at least one data row.');
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/^\s+|\s+$/g, ''));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4'
  });

  try {
    const [cols] = await conn.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
      [process.env.DB_NAME, tableName.toLowerCase()]
    );
    const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

    const needId = tableColumns.has('id');
    const needWixId = tableColumns.has('wix_id');
    const needCreatedAt = tableColumns.has('created_at');
    const needUpdatedAt = tableColumns.has('updated_at');
    const hasClientWixid = tableColumns.has('client_wixid');
    const hasClientId = tableColumns.has('client_id');

    const usedIds = new Set();
    const clientWixIdToId = new Map();

    async function resolveClientId(clientWixId) {
      if (!clientWixId || !hasClientId) return null;
      if (clientWixIdToId.has(clientWixId)) return clientWixIdToId.get(clientWixId);
      const [rows] = await conn.query(
        'SELECT id FROM clientdetail WHERE wix_id = ? LIMIT 1',
        [clientWixId]
      );
      const id = rows.length ? rows[0].id : null;
      clientWixIdToId.set(clientWixId, id);
      return id;
    }

    let inserted = 0;
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        let key = h === '_id' ? 'wix_id' : h;
        if (key === 'client') key = 'client_wixid';
        row[key] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      if (needId) {
        let uid;
        do { uid = randomUUID(); } while (usedIds.has(uid));
        usedIds.add(uid);
        row.id = uid;
      }
      if (needWixId && row.wix_id === undefined && row._id !== undefined) row.wix_id = row._id;
      if (needCreatedAt && row.created_at === undefined) row.created_at = new Date();
      if (needUpdatedAt && row.updated_at === undefined) row.updated_at = new Date();

      if (hasClientWixid && row.client_wixid && hasClientId) {
        row.client_id = await resolveClientId(row.client_wixid);
      }

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;

      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${tableName}\` (${colsList}) VALUES (${placeholders})`;
      await conn.query(sql, keys.map(k => row[k]));
      inserted++;
      if (inserted % 100 === 0) console.log('Inserted', inserted, 'rows...');
    }

    console.log('Done. Inserted', inserted, 'rows into', tableName);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
