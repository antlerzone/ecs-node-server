/**
 * Import Wix Damage.csv → `cln_damage` (every row attempted).
 *
 *   node scripts/import-cln-damage-wix-csv.js
 *
 * Imported from CSV only:
 *   ID → id
 *   unitName → property_id (when UUID matches `cln_property` under OPERATOR_ID; else NULL, row still inserts)
 *   Damage Photo → damage_photo_json
 *   Remark → remark
 *   Staff Name → staff_id (when UUID in employeedetail + employee_operator for operator; else NULL)
 *   Created Date / Updated Date → created_at / updated_at
 *
 * Not imported (ignored): Owner, Damage (Item) (Client), any other columns.
 * `wix_item_url` is always NULL; `wix_owner_id` is always NULL (not taken from CSV).
 *
 * `cln_damage` has no `operator_id` column — linkage is indirect: **only** `cln_property` rows
 * with `operator_id = OPERATOR_ID` count as a match for `unitName` → `property_id`.
 * Staff UUID must exist in `cln_employeedetail` **and** be linked in `cln_employee_operator` for that operator.
 *
 * Env: root `.env` DB_*
 *   CLN_IMPORT_OPERATOR_ID — optional; default below (must match `cln_property.operator_id` for linking)
 *   CLN_DAMAGE_CSV — optional; default `Import_csv/Damage.csv` under repo root
 *
 * CLI:
 *   node scripts/import-cln-damage-wix-csv.js
 *   node scripts/import-cln-damage-wix-csv.js "C:\\path\\to\\Damage.csv"
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DEFAULT_DAMAGE_CSV = path.join(__dirname, '..', 'Import_csv', 'Damage.csv');
const DAMAGE_CSV = (() => {
  const fromEnv = process.env.CLN_DAMAGE_CSV && String(process.env.CLN_DAMAGE_CSV).trim();
  const fromArgv = process.argv[2] && String(process.argv[2]).trim();
  const p = fromEnv || fromArgv || DEFAULT_DAMAGE_CSV;
  return path.isAbsolute(p) ? p : path.join(__dirname, '..', p);
})();

/** Same operator as property/staff imports — only their properties + staff count for FK hints. */
const DEFAULT_OPERATOR_ID = 'e48b2c25-399a-11f1-a4e2-00163e006722';
const OPERATOR_ID = String(process.env.CLN_IMPORT_OPERATOR_ID || DEFAULT_OPERATOR_ID).trim();

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

/** ISO / Wix date → MySQL DATETIME(3) UTC string */
function toMysqlDatetime3(iso) {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(String(iso).trim());
  if (Number.isNaN(d.getTime())) return null;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
}

/** LONGTEXT JSON: empty / [] → NULL */
function photoJsonOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '' || s === '[]') return null;
  return s;
}

async function run() {
  if (!fs.existsSync(DAMAGE_CSV)) {
    console.error('CSV not found:', DAMAGE_CSV);
    process.exit(1);
  }
  if (!isUuid(OPERATOR_ID)) {
    console.error('Invalid CLN_IMPORT_OPERATOR_ID / default operator UUID:', OPERATOR_ID);
    process.exit(1);
  }
  console.log('CSV:', DAMAGE_CSV);
  console.log('Operator filter:', OPERATOR_ID);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const [[{ n: hasOpCol }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_property' AND COLUMN_NAME = 'operator_id'`
  );
  const useOperatorProperty = Number(hasOpCol) === 1;

  let propertyIds = new Set();
  if (useOperatorProperty) {
    const [propRows] = await conn.query(
      'SELECT LOWER(TRIM(id)) AS id FROM cln_property WHERE LOWER(TRIM(operator_id)) = ?',
      [OPERATOR_ID.toLowerCase()]
    );
    propertyIds = new Set((propRows || []).map((r) => String(r.id).toLowerCase()).filter(Boolean));
  } else {
    const [propRows] = await conn.query('SELECT LOWER(TRIM(id)) AS id FROM cln_property');
    propertyIds = new Set((propRows || []).map((r) => String(r.id).toLowerCase()).filter(Boolean));
    console.warn('[warn] cln_property.operator_id missing — matching all properties (no operator filter).');
  }

  let employeeIds = new Set();
  try {
    const [[{ n: hasEo }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_employee_operator'`
    );
    if (Number(hasEo) === 1) {
      const [empRows] = await conn.query(
        `SELECT LOWER(TRIM(e.id)) AS id
         FROM cln_employeedetail e
         INNER JOIN cln_employee_operator eo ON eo.employee_id = e.id AND LOWER(TRIM(eo.operator_id)) = ?`,
        [OPERATOR_ID.toLowerCase()]
      );
      employeeIds = new Set((empRows || []).map((r) => String(r.id).toLowerCase()).filter(Boolean));
    } else {
      const [empRows] = await conn.query('SELECT LOWER(TRIM(id)) AS id FROM cln_employeedetail');
      employeeIds = new Set((empRows || []).map((r) => String(r.id).toLowerCase()).filter(Boolean));
      console.warn('[warn] cln_employee_operator missing — staff match uses all cln_employeedetail ids.');
    }
  } catch (e) {
    console.warn('[warn] staff id set not built:', e?.message || e);
  }

  const buf = stripBom(fs.readFileSync(DAMAGE_CSV, 'utf8'));
  const rows = parse(buf, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const stats = {
    total: rows.length,
    upserted: 0,
    skipNoId: 0,
    /** Rows where unitName matched cln_property.id for OPERATOR_ID */
    propertyLinked: 0,
    /** Rows where unitName missing or not under this operator (still inserted, property_id NULL) */
    propertyUnlinked: 0,
    /** Rows where Staff Name matched cln_employeedetail.id */
    staffLinked: 0,
    /** Rows where staff missing or not in cln_employeedetail (still inserted, staff_id NULL) */
    staffUnlinked: 0,
  };

  try {
    await conn.beginTransaction();

    for (const r of rows) {
      const id = strOrNull(r.ID ?? r.id);
      if (!id || !isUuid(id)) {
        stats.skipNoId += 1;
        continue;
      }
      const idLc = id.toLowerCase();

      const unitRaw = strOrNull(r.unitName ?? r.unitname ?? r.Unitname);
      const unitLc = unitRaw && isUuid(unitRaw) ? unitRaw.toLowerCase() : null;
      let propertyId = null;
      if (unitLc && propertyIds.has(unitLc)) {
        propertyId = unitLc;
        stats.propertyLinked += 1;
      } else {
        stats.propertyUnlinked += 1;
        if (unitRaw && (!unitLc || !propertyIds.has(unitLc))) {
          console.warn(
            '[warn] property not under operator or unknown unitName, property_id=NULL',
            idLc,
            'unitName=',
            unitRaw,
            'operator_id=',
            useOperatorProperty ? OPERATOR_ID : '(n/a)'
          );
        }
      }

      const staffRaw = strOrNull(r['Staff Name'] ?? r['staff name'] ?? r.StaffName);
      const staffLc = staffRaw && isUuid(staffRaw) ? staffRaw.toLowerCase() : null;
      let staffId = null;
      if (staffLc && employeeIds.size && employeeIds.has(staffLc)) {
        staffId = staffLc;
        stats.staffLinked += 1;
      } else {
        stats.staffUnlinked += 1;
        if (staffRaw && employeeIds.size && staffLc && !employeeIds.has(staffLc)) {
          console.warn(
            '[warn] staff not linked to operator (or not in employeedetail), staff_id=NULL',
            idLc,
            'Staff Name=',
            staffRaw
          );
        }
      }

      const photoJson = photoJsonOrNull(r['Damage Photo'] ?? r['damage photo']);
      const remark = strOrNull(r.Remark ?? r.remark);
      const createdAt = toMysqlDatetime3(r['Created Date'] ?? r['created date']);
      const updatedAt = toMysqlDatetime3(r['Updated Date'] ?? r['updated date']);

      await conn.query(
        `INSERT INTO cln_damage (
          id, wix_item_url, damage_photo_json, remark, property_id, staff_id, wix_owner_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE
          damage_photo_json = VALUES(damage_photo_json),
          remark = VALUES(remark),
          property_id = VALUES(property_id),
          staff_id = VALUES(staff_id),
          wix_owner_id = NULL,
          created_at = VALUES(created_at),
          updated_at = VALUES(updated_at)`,
        [idLc, null, photoJson, remark, propertyId, staffId, null, createdAt, updatedAt]
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
