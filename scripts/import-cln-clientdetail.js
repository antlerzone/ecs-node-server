/**
 * Import Wix CMS clientdetail CSV → cln_clientdetail + cln_client_operator.
 * Wix ID → id (0087 约定). Owner → cln_client_operator (operator_id → cln_operatordetail).
 *
 * Usage: node scripts/import-cln-clientdetail.js [csv_path]
 * Default: cleanlemon/next-app/clientdetail (1).csv
 *
 * Preflight: node scripts/verify-cln-csv-operators.js
 * Loose mode (skip junction when Owner missing in DB): CLN_IMPORT_LOOSE=1
 * Force single operator for all rows (CSV Owner ignored): CLN_IMPORT_OPERATOR_ID=<cln_operatordetail.id>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { resolveId } = require('./import-util');
const { splitCsvRows, parseCsvLine, normalizeVal, looksLikeUuid } = require('./import-cln-csv-shared');

const root = path.join(__dirname, '..');
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'cleanlemon/next-app/clientdetail (1).csv');

const loose = process.env.CLN_IMPORT_LOOSE === '1';
const forcedOperatorId = String(process.env.CLN_IMPORT_OPERATOR_ID || '').trim();

/** Wix export header → internal key (before cln_clientdetail column names). */
const HEADER_MAP = {
  ID: 'id',
  id: 'id',
  _id: 'id',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
  Owner: '_owner',
  email: 'email',
  name: 'fullname',
  phone: 'phone',
  address: 'address',
  bukkuContactId: '_bukku_contact_id',
  PIC: '_pic',
};

function buildAccountFromRow(ownerId, bukkuId) {
  const op = String(ownerId || '').trim();
  const bid = bukkuId != null && String(bukkuId).trim() !== '' ? String(bukkuId).trim() : '';
  if (!op || !looksLikeUuid(op) || !bid) return null;
  return JSON.stringify([{ clientId: op, provider: 'bukku', id: bid }]);
}

async function run() {
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    console.error('Usage: node scripts/import-cln-clientdetail.js [csv_path]');
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
  const [opRows] = await conn.query('SELECT id FROM cln_operatordetail');
  const validOperatorIds = new Set(opRows.map((r) => r.id));

  if (forcedOperatorId) {
    if (!looksLikeUuid(forcedOperatorId)) {
      console.error('[import-cln-clientdetail] CLN_IMPORT_OPERATOR_ID must be a UUID');
      process.exit(1);
    }
    if (!validOperatorIds.has(forcedOperatorId)) {
      console.error(
        '[import-cln-clientdetail] CLN_IMPORT_OPERATOR_ID not found in cln_operatordetail:',
        forcedOperatorId
      );
      process.exit(1);
    }
  }

  if (forcedOperatorId) {
    console.log('[import-cln-clientdetail] CLN_IMPORT_OPERATOR_ID:', forcedOperatorId);
  }

  const usedIds = new Set();
  let upserted = 0;
  let junctionInserted = 0;
  let junctionSkipped = 0;

  try {
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const raw = {};
      rawHeaders.forEach((h, idx) => {
        const key = HEADER_MAP[h] || HEADER_MAP[String(h).trim()];
        if (!key) return;
        raw[key] = values[idx] !== undefined ? normalizeVal(values[idx]) : null;
      });

      const row = {
        id: resolveId(raw, usedIds),
        email: raw.email,
        fullname: raw.fullname,
        phone: raw.phone,
        address: raw.address,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
      };

      const csvOwner =
        raw._owner != null && looksLikeUuid(String(raw._owner).trim()) ? String(raw._owner).trim() : null;
      const ownerId = forcedOperatorId && looksLikeUuid(forcedOperatorId) ? forcedOperatorId : csvOwner;
      const account = buildAccountFromRow(ownerId, raw._bukku_contact_id);

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;

      const hasData =
        row.id &&
        [row.email, row.fullname, row.phone, row.address].some((v) => v != null && String(v).trim() !== '');
      if (!hasData) continue;

      const insertCols = ['id', 'email', 'fullname', 'phone', 'address', 'created_at', 'updated_at'];
      const insertVals = [
        row.id,
        row.email,
        row.fullname,
        row.phone,
        row.address,
        row.created_at,
        row.updated_at,
      ];

      let updateSql =
        'email=VALUES(email), fullname=VALUES(fullname), phone=VALUES(phone), address=VALUES(address), updated_at=VALUES(updated_at)';
      if (account != null) {
        insertCols.splice(5, 0, 'account');
        insertVals.splice(5, 0, account);
        updateSql =
          'email=VALUES(email), fullname=VALUES(fullname), phone=VALUES(phone), address=VALUES(address), account=VALUES(account), updated_at=VALUES(updated_at)';
      }

      const ph = insertCols.map(() => '?').join(', ');
      const colList = insertCols.map((c) => `\`${c}\``).join(', ');
      await conn.query(
        `INSERT INTO cln_clientdetail (${colList}) VALUES (${ph}) ON DUPLICATE KEY UPDATE ${updateSql}`,
        insertVals
      );
      upserted++;

      if (ownerId && validOperatorIds.has(ownerId)) {
        await conn.query(
          'INSERT IGNORE INTO cln_client_operator (id, clientdetail_id, operator_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))',
          [randomUUID(), row.id, ownerId]
        );
        junctionInserted++;
      } else if (ownerId) {
        junctionSkipped++;
        console.warn(
          `[import-cln-clientdetail] row ${row.id}: Owner ${ownerId} not in cln_operatordetail — skipped cln_client_operator`
        );
      }
    }

    if (junctionSkipped > 0 && !loose) {
      console.error(
        '[import-cln-clientdetail] FATAL: some Owner UUIDs are missing from cln_operatordetail. Run scripts/verify-cln-csv-operators.js or CLN_IMPORT_LOOSE=1 to only skip junction rows.'
      );
      process.exit(1);
    }

    console.log(
      'Done. cln_clientdetail upserted:',
      upserted,
      'cln_client_operator INSERT IGNORE attempts (duplicates silently ignored):',
      junctionInserted,
      'rows with Owner not in cln_operatordetail (no junction):',
      junctionSkipped
    );
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
