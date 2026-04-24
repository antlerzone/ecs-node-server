/**
 * Import Wix-export staff CSV into cln_employeedetail + cln_employee_operator (single operator).
 * Uses Import_csv/bankcode.csv to map Wix bank UUID → bankdetail (match by name or INSERT).
 *
 * CSV column **Team** is stored on each employee in `cln_employee_operator.crm_json.team`, and — when
 * `cln_operator_team.operator_id` exists — **also** upserts **`cln_operator_team`** (name + member_ids_json)
 * so Operator Portal **Team** page (`/portal/operator/team`) lists teams and members.
 *
 *   node scripts/import-cln-staff-wix-csv.js
 *
 * Env: root .env DB_*
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const STAFF_CSV = path.join(__dirname, '..', 'Import_csv', 'Staff+Detail .csv');
const BANKCODE_CSV = path.join(__dirname, '..', 'Import_csv', 'bankcode.csv');

const OPERATOR_ID = 'e48b2c25-399a-11f1-a4e2-00163e006722';
const BUKKU_PROVIDER = 'bukku';

function normEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  return s || null;
}

function normName(v) {
  return String(v || '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === '') return false;
  return false;
}

function extractFirstWixImageSrc(cell) {
  if (!cell || !String(cell).trim()) return null;
  const s = String(cell).trim();
  if (s.startsWith('wix:')) return s;
  try {
    const j = JSON.parse(s);
    const arr = Array.isArray(j) ? j : [];
    for (const item of arr) {
      if (item && item.src) return String(item.src);
    }
  } catch {
    /* ignore */
  }
  const m = s.match(/wix:[^\s"']+/);
  return m ? m[0] : null;
}

function mergeAccountEntry(accountArr, clientId, provider, contactId) {
  const list = Array.isArray(accountArr) ? [...accountArr] : [];
  const p = String(provider).toLowerCase();
  const filtered = list.filter(
    (a) => !(a.clientId === clientId && String(a.provider || '').toLowerCase() === p)
  );
  if (contactId != null && String(contactId).trim() !== '') {
    filtered.push({ clientId, provider, id: String(contactId).trim() });
  }
  return filtered;
}

function normalizeSalaryStatutoryDefaults() {
  return { epfApplies: true, socsoApplies: true, eisApplies: true, mtdApplies: false };
}

function loadBankCodeMap() {
  let buf = fs.readFileSync(BANKCODE_CSV, 'utf8');
  if (buf.charCodeAt(0) === 0xfeff) buf = buf.slice(1);
  const rows = parse(buf, { columns: true, skip_empty_lines: true, relax_quotes: true });
  const map = new Map();
  for (const r of rows) {
    const rawId = r.ID ?? r.id ?? r['\uFEFFID'];
    const id = String(rawId || '').trim().toLowerCase();
    const name = String(r.bankname || r.bankName || '').trim();
    const swift = r.swiftcode != null ? String(r.swiftcode).trim() : '';
    if (id && name) map.set(id, { bankname: name, swiftcode: swift || null });
  }
  return map;
}

async function ensureBankdetailCache(conn) {
  const [rows] = await conn.query('SELECT id, bankname FROM bankdetail');
  const byNorm = new Map();
  for (const r of rows) {
    const k = String(r.bankname || '')
      .trim()
      .toLowerCase();
    if (k) byNorm.set(k, r.id);
  }
  return { rows, byNorm };
}

/**
 * Resolve Wix bank UUID → bankdetail.id (match by bankname; INSERT if missing).
 */
async function resolveBankId(conn, wixBankUuid, bankCodeMap, cache) {
  const u = String(wixBankUuid || '').trim().toLowerCase();
  if (!u) return null;
  const entry = bankCodeMap.get(u);
  if (!entry) {
    console.warn('[import] Unknown Wix bank UUID in staff row (not in bankcode.csv):', wixBankUuid);
    return null;
  }
  const canonical = entry.bankname.trim();
  const key = canonical.toLowerCase();
  if (cache.byNorm.has(key)) return cache.byNorm.get(key);

  const nid = crypto.randomUUID();
  await conn.query(
    'INSERT INTO bankdetail (id, owner_id, swiftcode, bankname, created_at, updated_at) VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [nid, entry.swiftcode, canonical]
  );
  cache.byNorm.set(key, nid);
  console.log('[import] INSERT bankdetail:', canonical, nid);
  return nid;
}

async function ensureOperatorTeamTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_team (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      operator_id CHAR(36) NULL COMMENT 'FK cln_operatordetail.id',
      name VARCHAR(255) NOT NULL,
      member_ids_json LONGTEXT NOT NULL,
      authorize_mode VARCHAR(32) NOT NULL DEFAULT 'full',
      selected_property_ids_json LONGTEXT NOT NULL,
      rest_days_json LONGTEXT NOT NULL,
      created_at DATE NULL,
      created_ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function hasOperatorTeamOperatorIdColumn(conn) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_operator_team' AND COLUMN_NAME = 'operator_id'`
  );
  return Number(r?.n) > 0;
}

/**
 * Upsert `cln_operator_team` rows for this operator: one row per distinct Team name in CSV,
 * member_ids_json = employee ids from CSV for that team (replaces list for those team names).
 */
async function syncClnOperatorTeamsFromTeamMap(conn, operatorId, teamNameToMemberIds) {
  if (!teamNameToMemberIds || teamNameToMemberIds.size === 0) return { teams: 0 };
  const hasOp = await hasOperatorTeamOperatorIdColumn(conn);
  if (!hasOp) {
    console.warn('[warn] cln_operator_team has no operator_id column; skip team table sync.');
    return { teams: 0 };
  }
  await ensureOperatorTeamTable(conn);
  const oid = String(operatorId || '').trim();
  const today = new Date().toISOString().slice(0, 10);
  let teams = 0;

  for (const [teamName, ids] of teamNameToMemberIds) {
    const name = String(teamName || '').trim();
    if (!name) continue;
    const memberIds = [...new Set((ids || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
    const membersJson = JSON.stringify(memberIds);

    const [[existing]] = await conn.query(
      'SELECT id FROM cln_operator_team WHERE operator_id = ? AND name = ? LIMIT 1',
      [oid, name]
    );
    if (existing?.id) {
      await conn.query(
        'UPDATE cln_operator_team SET member_ids_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? LIMIT 1',
        [membersJson, existing.id]
      );
    } else {
      const tid = crypto.randomUUID();
      await conn.query(
        `INSERT INTO cln_operator_team (
          id, operator_id, name, member_ids_json, authorize_mode, selected_property_ids_json, rest_days_json, created_at
        ) VALUES (?, ?, ?, ?, 'full', '[]', '[]', ?)`,
        [tid, oid, name, membersJson, today]
      );
    }
    teams += 1;
  }
  return { teams };
}

async function run() {
  const bankCodeMap = loadBankCodeMap();
  const staffBuf = fs.readFileSync(STAFF_CSV, 'utf8');
  const staffRows = parse(staffBuf, { columns: true, skip_empty_lines: true, relax_quotes: true });

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const cache = await ensureBankdetailCache(conn);

  let ok = 0;
  let err = 0;
  /** Team display name (CSV) → employee ids successfully upserted for this operator */
  const teamNameToMemberIds = new Map();

  try {
    await conn.beginTransaction();

    for (const raw of staffRows) {
      const id = String(raw.ID || raw.id || '').trim();
      if (!id) {
        console.warn('[import] Skip row without ID');
        err += 1;
        continue;
      }

      const name = normName(raw.Name);
      const email = normEmail(raw.Email);
      const phone = String(raw['Phone Number'] || raw.phone || '')
        .trim()
        .replace(/^'+/, '') || null;
      const address = String(raw.address || '').trim() || null;
      const idNumber = String(raw['NRIC/Passport'] || '').trim() || null;
      const team = String(raw.Team || '').trim() || null;
      const activation = parseBool(raw.activation);
      const status = activation ? 'active' : 'archived';
      const salaryBasic = Number(String(raw.salary ?? '').replace(/,/g, '')) || 0;
      const bankAccount = String(raw['Bank Account'] || '').trim() || '';
      const bankHolder = String(raw['Bank Holder Name'] || '').trim() || '';
      const wixBankUuid = String(raw.bankname || '').trim();
      const contactId = String(raw.Contact_id ?? raw['Contact_id'] ?? '').trim();
      const icCell = raw['IC Copy/Passport'] || '';
      const selfieCell = raw.Selfie || '';

      const icUrl = extractFirstWixImageSrc(icCell);
      const selfieUrl = extractFirstWixImageSrc(selfieCell) || (String(selfieCell).trim().startsWith('wix:') ? String(selfieCell).trim() : null);

      let bankId = null;
      if (wixBankUuid) {
        bankId = await resolveBankId(conn, wixBankUuid, bankCodeMap, cache);
      }

      const [[bdRow]] = bankId
        ? await conn.query('SELECT bankname FROM bankdetail WHERE id = ? LIMIT 1', [bankId])
        : [[null]];
      const bankDisplayName = bdRow?.bankname ? String(bdRow.bankname) : '';

      if (email) {
        await conn.query(
          'UPDATE cln_employeedetail SET email = NULL WHERE LOWER(TRIM(email)) = ? AND id != ?',
          [email, id]
        );
      }

      let accountJson = '[]';
      if (contactId) {
        accountJson = JSON.stringify(
          mergeAccountEntry([], OPERATOR_ID, BUKKU_PROVIDER, contactId)
        );
      }

      const crm = {
        status,
        joinedAt: null,
        employmentStatus: 'full-time',
        salaryBasic,
        team,
        bankName: bankDisplayName,
        bankAccountNo: bankAccount,
        icCopyUrl: icUrl || '#',
        passportCopyUrl: selfieUrl || '#',
        offerLetterUrl: null,
        workingWithUsCount: null,
        trainings: [],
        remarkHistory: [],
        portalRoles: ['staff'],
        salaryStatutoryDefaults: normalizeSalaryStatutoryDefaults(),
      };
      const createdStr = String(raw['Created Date'] || '').trim();
      if (createdStr && createdStr.length >= 10) {
        crm.joinedAt = createdStr.slice(0, 10);
      }

      await conn.query(
        `INSERT INTO cln_employeedetail (
          id, email, full_name, legal_name, phone, address, id_number,
          bank_id, bank_account_no, bank_account_holder,
          nric_front_url, nric_back_url, account, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE
          email = VALUES(email),
          full_name = VALUES(full_name),
          legal_name = VALUES(legal_name),
          phone = VALUES(phone),
          address = VALUES(address),
          id_number = VALUES(id_number),
          bank_id = VALUES(bank_id),
          bank_account_no = VALUES(bank_account_no),
          bank_account_holder = VALUES(bank_account_holder),
          nric_front_url = VALUES(nric_front_url),
          nric_back_url = VALUES(nric_back_url),
          account = VALUES(account),
          updated_at = CURRENT_TIMESTAMP(3)`,
        [
          id,
          email,
          name || null,
          name || null,
          phone,
          address,
          idNumber,
          bankId,
          bankAccount || null,
          bankHolder || null,
          icUrl,
          selfieUrl,
          accountJson,
        ]
      );

      const [[jRow]] = await conn.query(
        'SELECT id FROM cln_employee_operator WHERE employee_id = ? AND operator_id = ? LIMIT 1',
        [id, OPERATOR_ID]
      );
      const junctionId = jRow?.id || crypto.randomUUID();

      await conn.query(
        `INSERT INTO cln_employee_operator (id, employee_id, operator_id, staff_role, crm_json, created_at)
         VALUES (?, ?, ?, 'cleaner', ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE staff_role = 'cleaner', crm_json = VALUES(crm_json)`,
        [junctionId, id, OPERATOR_ID, JSON.stringify(crm)]
      );

      if (team) {
        const k = team;
        if (!teamNameToMemberIds.has(k)) teamNameToMemberIds.set(k, []);
        teamNameToMemberIds.get(k).push(id);
      }

      ok += 1;
    }

    const teamSync = await syncClnOperatorTeamsFromTeamMap(conn, OPERATOR_ID, teamNameToMemberIds);

    await conn.commit();
    console.log(
      'Done. Rows OK:',
      ok,
      'errors:',
      err,
      'operator:',
      OPERATOR_ID,
      'cln_operator_team rows synced:',
      teamSync.teams
    );
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
