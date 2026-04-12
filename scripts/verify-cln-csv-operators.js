/**
 * Preflight: every distinct Wix "Owner" UUID in Cleanlemons clientdetail / propertydetail CSVs
 * must exist in cln_operatordetail (FK for cln_client_operator + cln_property).
 *
 * Usage:
 *   node scripts/verify-cln-csv-operators.js [clientdetail.csv] [propertydetail.csv]
 * Defaults (repo paths):
 *   cleanlemon/next-app/clientdetail (1).csv
 *   cleanlemon/next-app/Propertydetail (6).csv
 *
 * Exit 1 if any Owner is missing from MySQL.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { splitCsvRows, parseCsvLine, normalizeVal, looksLikeUuid } = require('./import-cln-csv-shared');

const root = path.join(__dirname, '..');
const defaultClient = path.join(root, 'cleanlemon/next-app/clientdetail (1).csv');
const defaultProperty = path.join(root, 'cleanlemon/next-app/Propertydetail (6).csv');

const args = process.argv.slice(2).filter(Boolean);
const clientPath = args[0] ? path.resolve(args[0]) : defaultClient;
const propertyPath = args[1] ? path.resolve(args[1]) : defaultProperty;

function collectOwnersFromCsv(filePath) {
  const owners = new Set();
  if (!fs.existsSync(filePath)) {
    console.warn('[verify-cln-csv-operators] skip (not found):', filePath);
    return owners;
  }
  const lines = splitCsvRows(fs.readFileSync(filePath, 'utf8'));
  if (lines.length < 2) return owners;
  const headers = parseCsvLine(lines[0]).map((h) => String(h || '').replace(/^"|"$/g, '').trim());
  const ownerIdx = headers.findIndex((h) => h === 'Owner');
  if (ownerIdx < 0) {
    console.warn('[verify-cln-csv-operators] no Owner column in', filePath);
    return owners;
  }
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const raw = values[ownerIdx];
    const v = normalizeVal(raw);
    if (v != null && looksLikeUuid(v)) owners.add(String(v).trim());
  }
  return owners;
}

async function run() {
  const allOwners = new Set();
  for (const p of [clientPath, propertyPath]) {
    for (const id of collectOwnersFromCsv(p)) allOwners.add(id);
  }
  if (allOwners.size === 0) {
    console.log('[verify-cln-csv-operators] no Owner UUIDs found (check CSV paths).');
    process.exit(0);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  try {
    const ids = [...allOwners];
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT id FROM cln_operatordetail WHERE id IN (${placeholders})`,
      ids
    );
    const found = new Set(rows.map((r) => r.id));
    const missing = ids.filter((id) => !found.has(id));
    console.log('[verify-cln-csv-operators] distinct Owner UUIDs in CSVs:', ids.length);
    console.log('[verify-cln-csv-operators] found in cln_operatordetail:', found.size);
    if (missing.length) {
      console.error('[verify-cln-csv-operators] MISSING in cln_operatordetail (import operatordetail first):');
      for (const m of missing) console.error('  ', m);
      process.exit(1);
    }
    console.log('[verify-cln-csv-operators] OK — all Owner IDs exist.');
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
