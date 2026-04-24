/**
 * Import Wix Propertydetail.csv → cln_property (Cleanlemons).
 *
 *   node scripts/import-cln-property-wix-csv.js
 *
 * Rules (see conversation): skip Client empty / Client=Coliving; no address/waze/google/client_label/coliving_source;
 * clientdetail_id from clientdetail.csv name map + manual overrides + reference UUID fallback;
 * only clientdetail_id that exist in cln_client_operator for OPERATOR_ID.
 *
 * Env: root .env DB_*
 *
 * Lift: Wix L/M/H → portal `slow` / `medium` / `fast` (matches operator/property Select).
 * `min` (or `Estimate time` / `2h 30m` text) → `min_value` (portal “Estimate time” = whole minutes).
 * `Cleaning fees` / `warmcleaning` / `deepcleaning` / `generalcleaning` / `renovationcleaning` →
 *   `cleaning_fees` + legacy columns **and** `operator_cleaning_pricing_rows_json` (one row per service)
 *   so operator/property “Cleaning price” shows Homestay, Warm, Deep, etc. when present in CSV.
 *
 * Wix CSV column **`cc`** (gallery JSON) → **`cc_json`** full JSON; when DB has **`after_clean_photo_url`**,
 * also set it to the **first image URL** (`src` or string entry) so operator property “After clean sample” shows.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const PROPERTY_CSV = path.join(__dirname, '..', 'Import_csv', 'Propertydetail.csv');
const CLIENTDETAIL_CSV = path.join(__dirname, '..', 'Import_csv', 'clientdetail.csv');

const OPERATOR_ID = 'e48b2c25-399a-11f1-a4e2-00163e006722';

/** Manual Client text → cln_clientdetail.id */
const MANUAL_CLIENT = {
  'mw property management': '01a49c41-464d-4644-ad39-c03843e00517',
  citywood: '739c6fe8-ab62-4c63-925d-c4e2ec1e2686',
  'yue hong': '1eab0901-fead-482f-8cff-3f3659b82936',
};

function stripBom(buf) {
  let s = typeof buf === 'string' ? buf : buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

function normKey(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

/** ISO / Wix date → MySQL DATETIME(3) UTC string */
function toMysqlDatetime3(iso) {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(String(iso).trim());
  if (Number.isNaN(d.getTime())) return null;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

function numOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.trunc(n);
}

/** Same rules as portal `parseEstimateTextToMinutes` / `parseClnEstimateTimeInputToMinutes` (import-only). */
function parseEstimateTextToMinutesForImport(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  let total = 0;
  const hMatch = s.match(/(\d+)\s*h/);
  const mMatch = s.match(/(\d+)\s*m/);
  if (hMatch) total += parseInt(hMatch[1], 10) * 60;
  if (mMatch) total += parseInt(mMatch[1], 10);
  if (hMatch || mMatch) return total;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** Wix `min` (minutes) or optional `Estimate time` text → `cln_property.min_value`. */
function minValueFromPropertyCsvRow(r) {
  const candidates = [
    r.min,
    r.Min,
    r.MIN,
    r['min'],
    r['Estimate time'],
    r['estimate time'],
    r['Estimate Time'],
  ];
  for (const c of candidates) {
    if (c == null || String(c).trim() === '') continue;
    const asInt = intOrNull(c);
    if (asInt != null) return asInt;
    const parsed = parseEstimateTextToMinutesForImport(String(c));
    if (parsed != null) return parsed;
  }
  return null;
}

function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function ccOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '[]') return null;
  return s;
}

/** First image URL from Wix `cc` gallery JSON (for `after_clean_photo_url`). */
function firstUrlFromCcJson(ccRaw) {
  const s = ccOrNull(ccRaw);
  if (!s) return null;
  try {
    const raw = JSON.parse(s);
    if (!Array.isArray(raw)) return null;
    for (const item of raw) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (item && typeof item === 'object' && typeof item.src === 'string' && item.src.trim()) return item.src.trim();
    }
  } catch (_) {
    /* invalid JSON */
  }
  return null;
}

async function columnExists(conn, tableName, columnName) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(r?.n) > 0;
}

function boolTiny(v) {
  if (v === true || v === false) return v ? 1 : 0;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return 1;
  return 0;
}

/** Wix export: L/M/H → same tokens as Cleanlemons operator property form (slow/medium/fast). */
function normalizeLiftLevel(v) {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t) return null;
  const u = t.toUpperCase();
  if (u === 'L') return 'slow';
  if (u === 'M') return 'medium';
  if (u === 'H') return 'fast';
  return t.length <= 8 ? t : t.slice(0, 8);
}

/** Homestay cleaning fee: CSV "Cleaning fees" (trim). */
function cleaningFeesFromRow(r) {
  const raw = r['Cleaning fees'] ?? r['Cleaning Fees'] ?? r.cleaningfees;
  return numOrNull(raw);
}

function loadClientNameToId() {
  const buf = stripBom(fs.readFileSync(CLIENTDETAIL_CSV, 'utf8'));
  const rows = parse(buf, { columns: true, skip_empty_lines: true, relax_quotes: true });
  const map = new Map();
  for (const r of rows) {
    const id = strOrNull(r.ID || r.id);
    const name = strOrNull(r.name);
    if (!id || !name) continue;
    map.set(normKey(name), id);
  }
  return map;
}

function resolveClientdetailId(rawClient, reference, nameMap) {
  const nk = normKey(rawClient);
  if (MANUAL_CLIENT[nk]) return MANUAL_CLIENT[nk];
  const byName = nameMap.get(nk);
  if (byName) return byName;
  const ref = strOrNull(reference);
  if (ref && isUuid(ref)) return ref.trim().toLowerCase();
  return null;
}

async function loadHasOperatorCleaningPricingColumns(conn) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property'
       AND COLUMN_NAME IN (
         'operator_cleaning_price_myr',
         'operator_cleaning_pricing_service',
         'operator_cleaning_pricing_line',
         'operator_cleaning_pricing_rows_json'
       )`
  );
  const set = new Set((rows || []).map((r) => String(r.c)));
  const ok =
    set.has('operator_cleaning_price_myr') &&
    set.has('operator_cleaning_pricing_service') &&
    set.has('operator_cleaning_pricing_line') &&
    set.has('operator_cleaning_pricing_rows_json');
  return ok;
}

/** One JSON row per Wix price column (matches operator portal service keys). */
function operatorCleaningPricingBundleFromCsvRow(r) {
  const fee = cleaningFeesFromRow(r);
  const warm = numOrNull(r.warmcleaning);
  const deep = numOrNull(r.deepcleaning);
  const gen = numOrNull(r.generalcleaning);
  const ren = numOrNull(r.renovationcleaning);
  const pricingRows = [];
  const add = (service, myr) => {
    if (myr == null || !Number.isFinite(Number(myr)) || Number(myr) < 0) return;
    pricingRows.push({ service, line: '', myr: Number(myr) });
  };
  add('homestay', fee);
  add('warm', warm);
  add('deep', deep);
  add('general', gen);
  add('renovation', ren);
  if (!pricingRows.length) {
    return {
      operator_cleaning_price_myr: null,
      operator_cleaning_pricing_service: null,
      operator_cleaning_pricing_line: null,
      operator_cleaning_pricing_rows_json: null,
    };
  }
  const first = pricingRows[0];
  return {
    operator_cleaning_price_myr: first.myr,
    operator_cleaning_pricing_service: first.service,
    operator_cleaning_pricing_line: null,
    operator_cleaning_pricing_rows_json: JSON.stringify(pricingRows),
  };
}

async function run() {
  const nameMap = loadClientNameToId();

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const hasOpCleaningCols = await loadHasOperatorCleaningPricingColumns(conn);
  if (!hasOpCleaningCols) {
    console.warn(
      '[warn] cln_property missing operator cleaning pricing columns (run migrations 0297, 0298, 0300); import will skip those fields.'
    );
  }

  const hasAfterCleanPhotoUrl = await columnExists(conn, 'cln_property', 'after_clean_photo_url');
  if (!hasAfterCleanPhotoUrl) {
    console.warn('[warn] cln_property.after_clean_photo_url missing (run migration 0224+); cc_json only, no portal sample URL.');
  }

  const [opRows] = await conn.query(
    'SELECT clientdetail_id FROM cln_client_operator WHERE operator_id = ?',
    [OPERATOR_ID]
  );
  const allowed = new Set(opRows.map((r) => String(r.clientdetail_id).toLowerCase()));

  const propBuf = stripBom(fs.readFileSync(PROPERTY_CSV, 'utf8'));
  const rows = parse(propBuf, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const stats = {
    total: rows.length,
    skipEmptyClient: 0,
    skipColiving: 0,
    skipNoClientdetail: 0,
    skipNotLinked: 0,
    upserted: 0,
  };

  try {
    await conn.beginTransaction();

    for (const r of rows) {
      const clientRaw = strOrNull(r.Client);
      if (!clientRaw) {
        stats.skipEmptyClient += 1;
        continue;
      }
      if (normKey(clientRaw) === 'coliving') {
        stats.skipColiving += 1;
        continue;
      }

      const reference = strOrNull(r.reference);
      let cid = resolveClientdetailId(clientRaw, reference, nameMap);
      if (!cid) {
        stats.skipNoClientdetail += 1;
        console.warn('[skip no clientdetail]', r.ID, 'Client=', clientRaw, 'reference=', reference);
        continue;
      }
      cid = cid.toLowerCase();

      if (!allowed.has(cid)) {
        stats.skipNotLinked += 1;
        console.warn('[skip not linked to operator]', r.ID, 'clientdetail_id=', cid);
        continue;
      }

      const refUuid = reference && isUuid(reference) ? reference.trim().toLowerCase() : null;
      if (refUuid && refUuid !== cid) {
        console.warn('[warn ref != resolved client]', r.ID, 'using', cid, 'reference was', refUuid);
      }

      const id = strOrNull(r.ID || r.id);
      if (!id) continue;

      const createdAt = toMysqlDatetime3(r['Created Date']);
      const updatedAt = toMysqlDatetime3(r['Updated Date']);

      const fee = cleaningFeesFromRow(r);
      const op = hasOpCleaningCols ? operatorCleaningPricingBundleFromCsvRow(r) : null;
      const ccRaw = r.cc ?? r.CC;
      const afterCleanUrl = hasAfterCleanPhotoUrl ? firstUrlFromCcJson(ccRaw) : null;

      const vals = [
        id,
        OPERATOR_ID,
        cid,
        strOrNull(r.Owner),
        strOrNull(r['Property Name']),
        strOrNull(r.Contact),
        intOrNull(r.Score),
        minValueFromPropertyCsvRow(r),
        strOrNull(r.Team),
        strOrNull(r.Unitname),
        r['Mailbox Password'] != null && String(r['Mailbox Password']).trim() !== '' ? String(r['Mailbox Password']) : null,
        intOrNull(r.bedCount),
        intOrNull(r.roomCount),
        intOrNull(r.bathroomCount),
        intOrNull(r.kitchen),
        intOrNull(r.livingRoom),
        intOrNull(r.balcony),
        intOrNull(r.staircase),
        normalizeLiftLevel(r.liftLevel),
        intOrNull(r.specialAreaCount),
        fee,
        ...(hasOpCleaningCols
          ? [
              op.operator_cleaning_price_myr,
              op.operator_cleaning_pricing_service,
              op.operator_cleaning_pricing_line,
              op.operator_cleaning_pricing_rows_json,
            ]
          : []),
        strOrNull(r.sourceId),
        boolTiny(r.Isfroma),
        ccOrNull(ccRaw),
        ...(hasAfterCleanPhotoUrl ? [afterCleanUrl] : []),
        numOrNull(r.warmcleaning),
        numOrNull(r.deepcleaning),
        numOrNull(r.generalcleaning),
        numOrNull(r.renovationcleaning),
        createdAt,
        updatedAt,
      ];

      const opInsertBlock = hasOpCleaningCols
        ? `,
          operator_cleaning_price_myr, operator_cleaning_pricing_service,
          operator_cleaning_pricing_line, operator_cleaning_pricing_rows_json`
        : '';
      const opValuesBlock = hasOpCleaningCols ? ',?,?,?,?' : '';
      const opUpdateBlock = hasOpCleaningCols
        ? `,
          operator_cleaning_price_myr = VALUES(operator_cleaning_price_myr),
          operator_cleaning_pricing_service = VALUES(operator_cleaning_pricing_service),
          operator_cleaning_pricing_line = VALUES(operator_cleaning_pricing_line),
          operator_cleaning_pricing_rows_json = VALUES(operator_cleaning_pricing_rows_json)`
        : '';

      const afterPhotoInsert = hasAfterCleanPhotoUrl ? ', after_clean_photo_url' : '';
      const afterPhotoValues = hasAfterCleanPhotoUrl ? ',?' : '';
      const afterPhotoUpdate = hasAfterCleanPhotoUrl
        ? `,
          after_clean_photo_url = VALUES(after_clean_photo_url)`
        : '';

      await conn.query(
        `INSERT INTO cln_property (
          id, operator_id, clientdetail_id, owner_wix_id,
          property_name, contact, score, min_value, team,
          unit_name, mailbox_password,
          bed_count, room_count, bathroom_count,
          kitchen, living_room, balcony, staircase,
          lift_level, special_area_count,
          cleaning_fees${opInsertBlock},
          source_id, is_from_a,
          cc_json${afterPhotoInsert}, warmcleaning, deepcleaning, generalcleaning, renovationcleaning,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${opValuesBlock},?,?,?${afterPhotoValues},?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          operator_id = VALUES(operator_id),
          clientdetail_id = VALUES(clientdetail_id),
          owner_wix_id = VALUES(owner_wix_id),
          property_name = VALUES(property_name),
          contact = VALUES(contact),
          score = VALUES(score),
          min_value = VALUES(min_value),
          team = VALUES(team),
          unit_name = VALUES(unit_name),
          mailbox_password = VALUES(mailbox_password),
          bed_count = VALUES(bed_count),
          room_count = VALUES(room_count),
          bathroom_count = VALUES(bathroom_count),
          kitchen = VALUES(kitchen),
          living_room = VALUES(living_room),
          balcony = VALUES(balcony),
          staircase = VALUES(staircase),
          lift_level = VALUES(lift_level),
          special_area_count = VALUES(special_area_count),
          cleaning_fees = VALUES(cleaning_fees)${opUpdateBlock},
          source_id = VALUES(source_id),
          is_from_a = VALUES(is_from_a),
          cc_json = VALUES(cc_json)${afterPhotoUpdate},
          warmcleaning = VALUES(warmcleaning),
          deepcleaning = VALUES(deepcleaning),
          generalcleaning = VALUES(generalcleaning),
          renovationcleaning = VALUES(renovationcleaning),
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)`,
        vals
      );

      stats.upserted += 1;
    }

    await conn.commit();
    console.log('Done.', JSON.stringify(stats, null, 2));
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
