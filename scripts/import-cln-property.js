/**
 * Import Wix CMS Propertydetail CSV → cln_property.
 * Wix ID → id. Owner → operator_id + client_id + owner_wix_id (cln_operatordetail / legacy FK).
 * clientdetail_id from (first match wins):
 *   1) cc_json.wixClientReference if UUID exists in cln_clientdetail
 *   2) CSV column "reference" if UUID exists in cln_clientdetail (Wix client ref on property)
 *
 * Usage: node scripts/import-cln-property.js [csv_path]
 * Default: Import_csv/Propertydetail.csv (repo root)
 *
 * Address: Wix often stores one block with "Waze:" / "Google Map(s):" lines. If columns exist, the script
 * extracts URLs into `waze_url` / `google_maps_url` and trims the prose into `address` (same intent as
 * migration 0236). Optional: CLN_IMPORT_PREMISES_TYPE=apartment|landed|... sets `premises_type` on every row.
 *
 * Preflight: node scripts/verify-cln-csv-operators.js
 * CLN_IMPORT_LOOSE=1 — null operator_id/client_id/owner_wix_id when Owner missing in DB (still insert row)
 * CLN_IMPORT_OPERATOR_ID=<uuid> — use this cln_operatordetail.id for every row (CSV Owner ignored)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { resolveId } = require('./import-util');
const { splitCsvRows, parseCsvLine, normalizeVal, looksLikeUuid } = require('./import-cln-csv-shared');
const { splitAddressWazeGoogleFromText } = require('../src/modules/cleanlemon/cln-property-address-split');

const root = path.join(__dirname, '..');
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'Import_csv', 'Propertydetail.csv');

const loose = process.env.CLN_IMPORT_LOOSE === '1';
const forcedOperatorId = String(process.env.CLN_IMPORT_OPERATOR_ID || '').trim();
const importPremisesType = String(process.env.CLN_IMPORT_PREMISES_TYPE || '').trim().toLowerCase();
const VALID_PREMISES = new Set(['landed', 'apartment', 'office', 'commercial', 'other']);

const CSV_TO_DB = {
  ID: 'id',
  id: 'id',
  _id: 'id',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
  Owner: '_owner_wix',
  'Property Name': 'property_name',
  Contact: 'contact',
  Address: 'address',
  Score: 'score',
  min: 'min_value',
  Team: 'team',
  Client: 'client_label',
  Unitname: 'unit_name',
  'Mailbox Password': 'mailbox_password',
  bedCount: 'bed_count',
  roomCount: 'room_count',
  bathroomCount: 'bathroom_count',
  kitchen: 'kitchen',
  livingRoom: 'living_room',
  balcony: 'balcony',
  staircase: 'staircase',
  liftLevel: 'lift_level',
  specialAreaCount: 'special_area_count',
  'Cleaning fees': 'cleaning_fees',
  sourceId: 'source_id',
  Isfroma: 'is_from_a',
  cc: 'cc_json',
  warmcleaning: 'warmcleaning',
  deepcleaning: 'deepcleaning',
  generalcleaning: 'generalcleaning',
  renovationcleaning: 'renovationcleaning',
  Colivingsourceid: 'coliving_source_id',
  reference: '_reference_clientdetail_csv',
};

function tryParseCcForClientdetailId(ccVal, validClientdetailIds) {
  if (ccVal == null || String(ccVal).trim() === '') return null;
  const s = String(ccVal).trim();
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const ref = obj.wixClientReference != null ? String(obj.wixClientReference).trim() : '';
      if (ref && looksLikeUuid(ref) && validClientdetailIds.has(ref)) return ref;
    }
  } catch (_) {
    /* not JSON */
  }
  return null;
}

function intOrNull(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function decimalOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? s : null;
}

async function run() {
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    console.error('Usage: node scripts/import-cln-property.js [csv_path]');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = splitCsvRows(content);
  if (lines.length < 2) {
    console.error('CSV needs header + at least one data row.');
    process.exit(1);
  }

  const rawHeaders = parseCsvLine(lines[0]).map((h) => String(h || '').replace(/^"|"$/g, '').trim());

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const dbName = process.env.DB_NAME;
  const table = 'cln_property';
  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map((c) => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [opRows] = await conn.query('SELECT id FROM cln_operatordetail');
  const validOperatorIds = new Set(opRows.map((r) => r.id));

  if (forcedOperatorId) {
    if (!looksLikeUuid(forcedOperatorId)) {
      console.error('[import-cln-property] CLN_IMPORT_OPERATOR_ID must be a UUID');
      process.exit(1);
    }
    if (!validOperatorIds.has(forcedOperatorId)) {
      console.error(
        '[import-cln-property] CLN_IMPORT_OPERATOR_ID not found in cln_operatordetail:',
        forcedOperatorId
      );
      process.exit(1);
    }
  }

  const [cdRows] = await conn.query('SELECT id FROM cln_clientdetail');
  const validClientdetailIds = new Set(cdRows.map((r) => r.id));

  if (forcedOperatorId) {
    console.log('[import-cln-property] CLN_IMPORT_OPERATOR_ID:', forcedOperatorId);
  }
  if (importPremisesType) {
    if (!VALID_PREMISES.has(importPremisesType)) {
      console.error(
        '[import-cln-property] CLN_IMPORT_PREMISES_TYPE must be one of:',
        [...VALID_PREMISES].join(', ')
      );
      process.exit(1);
    }
    console.log('[import-cln-property] CLN_IMPORT_PREMISES_TYPE:', importPremisesType);
  }

  const usedIds = new Set();
  let upserted = 0;
  let missingOwnerRows = 0;

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row = {};
      rawHeaders.forEach((h, idx) => {
        const dbKey = CSV_TO_DB[h] || CSV_TO_DB[String(h).trim()];
        if (!dbKey || dbKey === '_skip') return;
        row[dbKey] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      row.id = resolveId(row, usedIds);

      const ownerRaw = row._owner_wix;
      delete row._owner_wix;
      const csvOwner =
        ownerRaw != null && looksLikeUuid(String(ownerRaw).trim()) ? String(ownerRaw).trim() : null;
      const ownerId = forcedOperatorId && looksLikeUuid(forcedOperatorId) ? forcedOperatorId : csvOwner;

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;

      if (tableColumns.has('operator_id') || tableColumns.has('client_id') || tableColumns.has('owner_wix_id')) {
        if (ownerId && validOperatorIds.has(ownerId)) {
          if (tableColumns.has('operator_id')) row.operator_id = ownerId;
          if (tableColumns.has('client_id')) row.client_id = ownerId;
          if (tableColumns.has('owner_wix_id')) row.owner_wix_id = ownerId;
        } else if (ownerId) {
          missingOwnerRows++;
          if (!loose) {
            console.warn(`[import-cln-property] row ${row.id}: Owner ${ownerId} not in cln_operatordetail`);
          } else {
            if (tableColumns.has('operator_id')) row.operator_id = null;
            if (tableColumns.has('client_id')) row.client_id = null;
            if (tableColumns.has('owner_wix_id')) row.owner_wix_id = null;
          }
        }
      }

      const refCsv =
        row._reference_clientdetail_csv != null &&
        looksLikeUuid(String(row._reference_clientdetail_csv).trim())
          ? String(row._reference_clientdetail_csv).trim()
          : null;
      delete row._reference_clientdetail_csv;

      if (tableColumns.has('clientdetail_id')) {
        const fromCc = tryParseCcForClientdetailId(row.cc_json, validClientdetailIds);
        if (fromCc) {
          row.clientdetail_id = fromCc;
        } else if (refCsv && validClientdetailIds.has(refCsv)) {
          row.clientdetail_id = refCsv;
        }
      }

      for (const k of ['score', 'min_value', 'bed_count', 'room_count', 'bathroom_count', 'kitchen', 'living_room', 'balcony', 'staircase', 'special_area_count']) {
        if (row[k] != null && tableColumns.has(k)) row[k] = intOrNull(row[k]);
      }

      for (const k of ['cleaning_fees', 'warmcleaning', 'deepcleaning', 'generalcleaning', 'renovationcleaning']) {
        if (row[k] != null && tableColumns.has(k)) {
          const d = decimalOrNull(row[k]);
          row[k] = d;
        }
      }

      if (row.address != null && String(row.address).trim() !== '') {
        const split = splitAddressWazeGoogleFromText(row.address);
        if (tableColumns.has('address')) {
          const a = (split.address || '').trim();
          row.address = a === '' ? null : a;
        }
        if (tableColumns.has('waze_url') && split.wazeUrl) row.waze_url = split.wazeUrl;
        if (tableColumns.has('google_maps_url') && split.googleUrl) row.google_maps_url = split.googleUrl;
      }

      if (importPremisesType && tableColumns.has('premises_type')) {
        row.premises_type = importPremisesType;
      }

      const hasData =
        row.id &&
        [row.property_name, row.address, row.contact, row.unit_name, row.client_label].some(
          (v) => v != null && String(v).trim() !== ''
        );
      if (!hasData) continue;

      const keys = Object.keys(row).filter((k) => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;

      const colsList = keys.map((k) => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const updates = keys.filter((k) => k !== 'id').map((k) => `\`${k}\`=VALUES(\`${k}\`)`).join(', ');
      const sql = `INSERT INTO \`${table}\` (${colsList}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
      await conn.query(sql, keys.map((k) => row[k]));
      upserted++;
      if (upserted % 100 === 0) console.log('Upserted', upserted, '...');
    }

    if (missingOwnerRows > 0 && !loose) {
      console.error(
        `[import-cln-property] FATAL: ${missingOwnerRows} rows reference Owner not in cln_operatordetail. Run verify-cln-csv-operators.js or CLN_IMPORT_LOOSE=1.`
      );
      process.exit(1);
    }

    console.log('Done. Upserted', upserted, 'rows into', table);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
