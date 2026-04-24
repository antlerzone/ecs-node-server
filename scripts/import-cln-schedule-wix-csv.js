/**
 * Import Wix Schedule.csv → `cln_schedule`.
 *
 *   node scripts/import-cln-schedule-wix-csv.js
 *   node scripts/import-cln-schedule-wix-csv.js "C:\\path\\to\\Schedule.csv"
 *
 * Env: root `.env` DB_* ; optional `CLN_IMPORT_OPERATOR_ID`, `CLN_SCHEDULE_CSV`
 *
 * Skipped CSV columns (not written): Schedule (Item), Owner, delay, Point → wix_item_url / owner_wix_id / delay / point stay NULL.
 * Skipped rows: no valid `ID` UUID (logged). Two property UUIDs never get property_id even if present in CSV.
 * property_id: only when row exists in cln_property AND operator_id matches CLN_IMPORT_OPERATOR_ID.
 * Re-run: ON DUPLICATE KEY UPDATE from CSV.
 *
 * Status (Wix / free text → DB slug, aligned with cleanlemon.service `normalizeScheduleStatus`):
 *   completed / done, in-progress, cancelled as usual
 *   pending-checkout: "Pending Check Out" (check-out), checkout, customer missing, empty CSV status
 *   ready-to-clean: explicit "Ready to Clean" style (ready + clean)
 *   default unknown → pending-checkout (not ready-to-clean)
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DEFAULT_CSV = path.join(__dirname, '..', 'Import_csv', 'Schedule.csv');
const SCHEDULE_CSV = (() => {
  const fromEnv = process.env.CLN_SCHEDULE_CSV && String(process.env.CLN_SCHEDULE_CSV).trim();
  const fromArgv = process.argv[2] && String(process.argv[2]).trim();
  const p = fromEnv || fromArgv || DEFAULT_CSV;
  return path.isAbsolute(p) ? p : path.join(__dirname, '..', p);
})();

const DEFAULT_OPERATOR_ID = 'e48b2c25-399a-11f1-a4e2-00163e006722';
const OPERATOR_ID = String(process.env.CLN_IMPORT_OPERATOR_ID || DEFAULT_OPERATOR_ID).trim();

/** Never set property_id for these (not in cln_property / business rule). */
const PROPERTY_ID_BLOCKLIST = new Set([
  '552b3c7c-9aa2-4c30-a07f-b02cf25df0b7',
  'f661f694-3a33-4957-a57c-5f3b0575d515',
]);

function stripBom(buf) {
  let s = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

/** Aligned with cleanlemon.service.js `normalizeScheduleStatus` — write canonical slug to DB. */
function normalizeScheduleStatus(s) {
  const raw = String(s ?? '').trim();
  if (raw === '') return 'pending-checkout';
  const x = raw.toLowerCase().replace(/\s+/g, '-');
  if (x.includes('complete')) return 'completed';
  if (x === 'done') return 'completed';
  if (x.includes('progress')) return 'in-progress';
  if (x.includes('cancel')) return 'cancelled';
  if (
    x.includes('checkout') ||
    x.includes('check-out') ||
    x === 'pending-checkout' ||
    x === 'pending-check-out'
  ) {
    return 'pending-checkout';
  }
  if (x.includes('customer') && x.includes('missing')) return 'pending-checkout';
  if (x.includes('ready') && x.includes('clean')) return 'ready-to-clean';
  return 'pending-checkout';
}

function toMysqlDatetime3(iso) {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(String(iso).trim());
  if (Number.isNaN(d.getTime())) return null;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

function photoJsonOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '[]') return null;
  return s;
}

function decimalOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function tinyintOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return 1;
  if (s === 'false' || s === '0' || s === 'no') return 0;
  const n = parseInt(s, 10);
  if (n === 1 || n === 0) return n;
  return null;
}

async function loadScheduleColumnSet(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_schedule'`
  );
  return new Set((rows || []).map((r) => String(r.c).toLowerCase()));
}

async function run() {
  if (!fs.existsSync(SCHEDULE_CSV)) {
    console.error('CSV not found:', SCHEDULE_CSV);
    process.exit(1);
  }
  if (!isUuid(OPERATOR_ID)) {
    console.error('Invalid CLN_IMPORT_OPERATOR_ID:', OPERATOR_ID);
    process.exit(1);
  }
  console.log('CSV:', SCHEDULE_CSV);
  console.log('Operator:', OPERATOR_ID);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const colSet = await loadScheduleColumnSet(conn);
  const need = (c) => colSet.has(c.toLowerCase());

  const [[{ n: hasOpCol }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_id'`
  );
  if (Number(hasOpCol) !== 1) {
    console.error('cln_property.operator_id required for this import.');
    process.exit(1);
  }

  const [propRows] = await conn.query(
    'SELECT LOWER(TRIM(id)) AS id FROM cln_property WHERE LOWER(TRIM(operator_id)) = ?',
    [OPERATOR_ID.toLowerCase()]
  );
  const propertyIdsForOp = new Set((propRows || []).map((r) => String(r.id).toLowerCase()).filter(Boolean));

  const buf = stripBom(fs.readFileSync(SCHEDULE_CSV, 'utf8'));
  const rows = parse(buf, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const stats = {
    totalCsvRows: rows.length,
    upserted: 0,
    skippedNoId: 0,
    skippedNoIdLines: [],
    rowsWithPropertyId: 0,
    rowsWithoutPropertyId: 0,
  };

  const insertCols = [
    'id',
    'wix_item_url',
    'owner_wix_id',
    'working_day',
    'date_display',
    'status',
    'cleaning_type',
    'submit_by',
    'staff_start_email',
    'start_time',
    'staff_end_email',
    'end_time',
    'finalphoto_json',
    'delay',
    'on_change_by',
    'property_id',
    'team',
    'point',
    'on_change_time',
    'price',
    'btob',
    'reservation_id',
    'invoiced',
    'invoice_date',
    'updated_time_wix',
    'created_at',
    'updated_at',
  ].filter((c) => need(c));

  if (!insertCols.includes('id')) {
    console.error('cln_schedule.id missing');
    process.exit(1);
  }
  if (!insertCols.includes('status')) {
    console.error(
      'cln_schedule.status is not in this DB schema (information_schema). Import cannot update status; fix table/column names.',
    );
    process.exit(1);
  }

  const dbHost = String(process.env.DB_HOST || '').trim();
  const dbName = String(process.env.DB_NAME || '').trim();
  console.log('DB target:', dbName || '(unset)', '@', dbHost || '(unset)', '(confirm this matches where you query in Navicat)');

  const placeholders = insertCols.map(() => '?').join(', ');
  const updates = insertCols
    .filter((c) => c !== 'id')
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');
  const quotedCols = insertCols.map((c) => `\`${c}\``).join(', ');
  const sql = `INSERT INTO cln_schedule (${quotedCols}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;

  try {
    await conn.beginTransaction();

    let lineNo = 1;
    for (const r of rows) {
      lineNo += 1;
      const idRaw = strOrNull(r.ID ?? r.id);
      if (!idRaw || !isUuid(idRaw)) {
        stats.skippedNoId += 1;
        if (stats.skippedNoIdLines.length < 50) stats.skippedNoIdLines.push(lineNo);
        continue;
      }
      const idLc = idRaw.toLowerCase();

      const propRaw = strOrNull(r.property ?? r.Property);
      const propLc = propRaw && isUuid(propRaw) ? propRaw.toLowerCase() : null;
      let propertyId = null;
      if (propLc && !PROPERTY_ID_BLOCKLIST.has(propLc) && propertyIdsForOp.has(propLc)) {
        propertyId = propLc;
        stats.rowsWithPropertyId += 1;
      } else {
        stats.rowsWithoutPropertyId += 1;
      }

      const row = {};
      if (need('id')) row.id = idLc;
      if (need('wix_item_url')) row.wix_item_url = null;
      if (need('owner_wix_id')) row.owner_wix_id = null;
      if (need('working_day')) row.working_day = toMysqlDatetime3(r['Working Day'] ?? r.workingday);
      if (need('date_display')) row.date_display = strOrNull(r.Date ?? r.date);
      if (need('status')) row.status = normalizeScheduleStatus(r.status ?? r.Status);
      if (need('cleaning_type')) row.cleaning_type = strOrNull(r.cleaningtype);
      if (need('submit_by')) row.submit_by = strOrNull(r.submitby);
      if (need('staff_start_email')) row.staff_start_email = strOrNull(r.staffnamestart ?? r['staffnamestart']);
      if (need('start_time')) row.start_time = toMysqlDatetime3(r.starttime);
      if (need('staff_end_email')) row.staff_end_email = strOrNull(r.staffnameend);
      if (need('end_time')) row.end_time = toMysqlDatetime3(r.staffendtime);
      if (need('finalphoto_json')) {
        const fpRaw = r.finalphoto ?? r.finalPhoto ?? r['final photo'] ?? r['Final photo'];
        row.finalphoto_json = photoJsonOrNull(fpRaw);
      }
      if (need('delay')) row.delay = null;
      if (need('on_change_by')) row.on_change_by = strOrNull(r.onchangeby);
      if (need('property_id')) row.property_id = propertyId;
      if (need('team')) row.team = strOrNull(r.team ?? r.Team);
      if (need('point')) row.point = null;
      if (need('on_change_time')) row.on_change_time = toMysqlDatetime3(r.onchangeTime);
      if (need('price')) row.price = decimalOrNull(r.price ?? r.Price);
      if (need('btob')) row.btob = tinyintOrNull(r.Btob ?? r.btob);
      if (need('reservation_id')) row.reservation_id = strOrNull(r.reservationId);
      if (need('invoiced')) row.invoiced = tinyintOrNull(r.invoiced);
      if (need('invoice_date')) row.invoice_date = toMysqlDatetime3(r.Invoicedate);
      if (need('updated_time_wix')) row.updated_time_wix = toMysqlDatetime3(r.Updatedtime);
      if (need('created_at')) row.created_at = toMysqlDatetime3(r['Created Date'] ?? r['created date']);
      if (need('updated_at')) row.updated_at = toMysqlDatetime3(r['Updated Date'] ?? r['updated date']);

      const vals = insertCols.map((k) => row[k] ?? null);
      await conn.query(sql, vals);
      stats.upserted += 1;
      if (stats.upserted % 500 === 0) console.log('Upserted', stats.upserted, '...');
    }

    await conn.commit();
    console.log('Done.', JSON.stringify(stats, null, 2));
    if (stats.skippedNoIdLines.length) {
      console.log('Skipped no-ID line numbers (first up to 50):', stats.skippedNoIdLines.join(', '));
    }
  } catch (e) {
    await conn.rollback();
    console.error('Rolled back:', e);
    throw e;
  } finally {
    await conn.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
