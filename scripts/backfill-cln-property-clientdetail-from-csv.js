/**
 * 仅根据 Propertydetail CSV 的「reference」列，把 cln_clientdetail.id 写进 cln_property.clientdetail_id。
 * 不读 Owner、不重插整行 — 适合已有物业数据、只需补客户绑定。
 *
 *   node scripts/backfill-cln-property-clientdetail-from-csv.js [path/to/Propertydetail.csv]
 * 默认: Import_csv/Propertydetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { splitCsvRows, parseCsvLine, normalizeVal } = require('./import-cln-csv-shared');

const root = path.join(__dirname, '..');
const csvPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'Import_csv', 'Propertydetail.csv');

function looksLikeUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = splitCsvRows(content);
  if (lines.length < 2) {
    console.error('CSV needs header + data.');
    process.exit(1);
  }

  const rawHeaders = parseCsvLine(lines[0]).map((h) => String(h || '').replace(/^"|"$/g, '').trim());
  const idxId = rawHeaders.findIndex((h) => String(h).toLowerCase() === 'id');
  const idxRef = rawHeaders.findIndex((h) => String(h).toLowerCase() === 'reference');
  if (idxId < 0 || idxRef < 0) {
    console.error('CSV must have columns: ID, reference');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const dbName = process.env.DB_NAME;
  const [[{ n: hasCd }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'clientdetail_id'`,
    [dbName]
  );
  if (Number(hasCd) !== 1) {
    console.error('cln_property.clientdetail_id column missing');
    process.exit(1);
  }

  const [cdRows] = await conn.query('SELECT id FROM cln_clientdetail');
  const validCd = new Set(cdRows.map((r) => String(r.id).toLowerCase()));

  let updated = 0;
  let skippedNoProp = 0;
  let skippedBadRef = 0;
  let unchanged = 0;

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const idRaw = values[idxId] !== undefined ? normalizeVal(values[idxId]) : null;
    const refRaw = values[idxRef] !== undefined ? normalizeVal(values[idxRef]) : null;
    const pid = idRaw && looksLikeUuid(String(idRaw).trim()) ? String(idRaw).trim().toLowerCase() : null;
    const ref = refRaw && looksLikeUuid(String(refRaw).trim()) ? String(refRaw).trim().toLowerCase() : null;
    if (!pid) continue;
    if (!ref || !validCd.has(ref)) {
      skippedBadRef += 1;
      continue;
    }

    const [rows] = await conn.query(
      'SELECT LOWER(TRIM(clientdetail_id)) AS cid FROM cln_property WHERE id = ? LIMIT 1',
      [pid]
    );
    if (!rows.length) {
      skippedNoProp += 1;
      continue;
    }
    const cur = rows[0].cid != null ? String(rows[0].cid).toLowerCase() : '';
    if (cur === ref) {
      unchanged += 1;
      continue;
    }

    await conn.query('UPDATE cln_property SET clientdetail_id = ? WHERE id = ?', [ref, pid]);
    updated += 1;
  }

  await conn.end();
  console.log('Done.', {
    csv: csvPath,
    updatedClientdetail: updated,
    skippedNoPropertyInDb: skippedNoProp,
    skippedInvalidOrEmptyReference: skippedBadRef,
    alreadyHadSameClient: unchanged,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
