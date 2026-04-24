/**
 * Import Wix-exported clientdetail CSV into cln_clientdetail + cln_client_operator.
 *
 * Usage:
 *   node scripts/import-cln-clientdetail-wix-csv.js [path/to/clientdetail.csv]
 *
 * Env: same as API (.env with DB_*).
 *
 * Rules (see team agreement):
 * - Skip rows with no email
 * - Skip rows with empty bukkuContactId
 * - fullname from CSV "name"; PIC not stored
 * - Phone normalized (MY 60 / SG 65)
 * - account[] merged with { clientId: operatorId, provider: bukku, id: bukkuContactId }
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { parse } = require('csv-parse/sync');
const pool = require('../src/config/db');
const { mergeAccountEntry } = require('../src/modules/contact/contact-sync.service');

const DEFAULT_CSV = path.join(__dirname, '..', 'Import_csv', 'clientdetail.csv');
const OPERATOR_ID = 'e48b2c25-399a-11f1-a4e2-00163e006722';

function safeJson(s, fallback) {
  if (s == null || s === '') return fallback;
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return v;
  } catch {
    return fallback;
  }
}

/** MY/SG mobile normalization: digits only; 01x → 60; 8-digit SG → 65 */
function normalizePhone(raw) {
  const t = String(raw || '').trim();
  if (!t || t === '-') return null;
  let d = t.replace(/[\s\-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  d = d.replace(/\D/g, '');
  if (!d) return null;

  if (d.startsWith('60') && d.length >= 10) return d;
  if (d.startsWith('65') && d.length >= 8) return d;

  if (d.startsWith('0') && d.length >= 9 && d.length <= 11) {
    return `60${d.slice(1)}`;
  }
  if (d.startsWith('1') && d.length >= 9 && d.length <= 10 && !d.startsWith('65')) {
    return `60${d}`;
  }
  if (d.length === 8 && /^[89]/.test(d)) {
    return `65${d}`;
  }
  return d;
}

async function resolveOperatorTable(conn) {
  const [[r]] = await conn.query(
    `SELECT SUM(CASE WHEN table_name = 'cln_operatordetail' THEN 1 ELSE 0 END) AS od
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('cln_operatordetail','cln_operator')`
  );
  return Number(r?.od) > 0 ? 'cln_operatordetail' : 'cln_operator';
}

async function hasColumn(conn, table, col) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r?.c) > 0;
}

function stripCsvQuotes(s) {
  let t = String(s ?? '').trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  return t;
}

function rowVal(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return stripCsvQuotes(row[k]);
    }
  }
  const lower = Object.fromEntries(Object.entries(row).map(([a, b]) => [a.toLowerCase(), b]));
  for (const k of keys) {
    const lk = k.toLowerCase();
    if (lower[lk] !== undefined && lower[lk] !== null && String(lower[lk]).trim() !== '') {
      return stripCsvQuotes(lower[lk]);
    }
  }
  return '';
}

async function main() {
  const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSV;
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true, bom: true });

  const conn = await pool.getConnection();
  try {
    const odTable = await resolveOperatorTable(conn);
    const [[op]] = await conn.query(`SELECT id FROM \`${odTable}\` WHERE id = ? LIMIT 1`, [OPERATOR_ID]);
    if (!op) {
      console.error(`Operator id not found in ${odTable}:`, OPERATOR_ID);
      process.exit(1);
    }

    const hasCrm = await hasColumn(conn, 'cln_client_operator', 'crm_json');

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const warnings = [];

    await conn.beginTransaction();

    for (const row of rows) {
      const id = rowVal(row, 'ID', 'id');
      const emailRaw = rowVal(row, 'email', 'Email');
      const emailNorm = emailRaw.toLowerCase();
      const name = rowVal(row, 'name', 'Name');
      const bukkuRaw = rowVal(row, 'bukkuContactId', 'bukkucontactid', 'BukkuContactId');

      if (!emailNorm) {
        warnings.push(`skip (no email): id=${id || '?'}`);
        skipped += 1;
        continue;
      }
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        warnings.push(`skip (bad id): email=${emailNorm}`);
        skipped += 1;
        continue;
      }
      if (!name) {
        warnings.push(`skip (no name): ${emailNorm}`);
        skipped += 1;
        continue;
      }
      if (!bukkuRaw) {
        warnings.push(`skip (no bukkuContactId): ${emailNorm}`);
        skipped += 1;
        continue;
      }

      const phoneRaw = rowVal(row, 'phone', 'Phone');
      const phoneNorm = normalizePhone(phoneRaw);
      const addr = rowVal(row, 'address', 'Address');
      const addressVal = addr || null;

      const [[emailRow]] = await conn.query(
        `SELECT id FROM cln_clientdetail WHERE LOWER(TRIM(email)) = ? LIMIT 1`,
        [emailNorm]
      );
      if (emailRow && String(emailRow.id) !== id) {
        warnings.push(`skip (email used by other id ${emailRow.id}): ${emailNorm}`);
        skipped += 1;
        continue;
      }

      const [[existing]] = await conn.query(`SELECT account FROM cln_clientdetail WHERE id = ? LIMIT 1`, [id]);
      let accountArr = safeJson(existing?.account, []);
      if (!Array.isArray(accountArr)) accountArr = [];
      accountArr = mergeAccountEntry(accountArr, OPERATOR_ID, 'bukku', String(bukkuRaw).trim());

      const accountJson = JSON.stringify(accountArr);

      const remarkLine = `${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}: imported from Wix CSV`;
      const crm = {
        status: 'active',
        joinedAt: new Date().toISOString().slice(0, 10),
        employmentStatus: 'full-time',
        salaryBasic: 0,
        bankName: '',
        bankAccountNo: '',
        icCopyUrl: '#',
        passportCopyUrl: '#',
        trainings: [],
        remarkHistory: [remarkLine],
        workingWithUsCount: null,
        accountingProvider: 'bukku',
        accountingContactId: String(bukkuRaw).trim(),
      };
      const crmJson = JSON.stringify(crm);

      if (existing) {
        await conn.query(
          `UPDATE cln_clientdetail SET email = ?, fullname = ?, phone = ?, address = ?, account = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [emailNorm, name, phoneNorm, addressVal, accountJson, id]
        );
        updated += 1;
      } else {
        await conn.query(
          `INSERT INTO cln_clientdetail (id, email, fullname, phone, address, account, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))`,
          [id, emailNorm, name, phoneNorm, addressVal, accountJson]
        );
        inserted += 1;
      }

      const [[j]] = await conn.query(
        `SELECT id FROM cln_client_operator WHERE clientdetail_id = ? AND operator_id = ? LIMIT 1`,
        [id, OPERATOR_ID]
      );

      if (j) {
        if (hasCrm) {
          await conn.query(`UPDATE cln_client_operator SET crm_json = ? WHERE id = ?`, [crmJson, j.id]);
        }
      } else {
        const jid = randomUUID();
        if (hasCrm) {
          await conn.query(
            `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, crm_json, created_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
            [jid, id, OPERATOR_ID, crmJson]
          );
        } else {
          await conn.query(
            `INSERT INTO cln_client_operator (id, clientdetail_id, operator_id, created_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP(3))`,
            [jid, id, OPERATOR_ID]
          );
        }
      }
    }

    await conn.commit();

    console.log(JSON.stringify({ ok: true, csvPath, inserted, updated, skipped, warnings }, null, 2));
  } catch (e) {
    await conn.rollback();
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
