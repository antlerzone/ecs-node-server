/**
 * Undo mistaken onboard account rows: merge Wix-era duplicate titles to canonical template ids (0157),
 * remap rentalcollection rows that pointed at placeholder accounts, delete placeholders.
 *
 * Usage:
 *   node scripts/remap-wix-accounts-to-canonical.js [path/to/bukkuid.csv]
 * Default bukkuid: cleanlemon/next-app/Wix cms/bukkuid (2).csv
 *
 * Steps:
 *   1) Normalize common typos on account.title so 0157 can match
 *   2) Run migration 0157 (dedupe by title → canonical id)
 *   3) Remap rentalcollection.type_id from placeholder rows using bukkuid CSV id→title→canonical
 *   4) DELETE placeholder account rows
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  canonicalAccountIdForWixTitle,
  PLACEHOLDER_TITLE,
} = require('./lib/account-canonical-map');
const { ensureCanonicalAccounts } = require('./lib/ensure-canonical-accounts');

const bukkuidPath =
  process.argv[2] ||
  path.join(process.cwd(), 'cleanlemon/next-app/Wix cms/bukkuid (2).csv');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      q = !q;
      continue;
    }
    if (!q && line[i] === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += line[i];
  }
  out.push(cur.trim());
  return out;
}

function splitCsvRows(c) {
  const rows = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < c.length; i++) {
    if (c[i] === '"') {
      q = !q;
      cur += c[i];
      continue;
    }
    if (!q && (c[i] === '\n' || c[i] === '\r')) {
      if (cur.trim()) rows.push(cur);
      cur = '';
      if (c[i] === '\r' && c[i + 1] === '\n') i++;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

function loadBukkuidIdToTitle(csvPath) {
  const map = new Map();
  if (!fs.existsSync(csvPath)) {
    console.warn('[warn] bukkuid CSV not found:', csvPath);
    return map;
  }
  const lines = splitCsvRows(fs.readFileSync(csvPath, 'utf8'));
  if (lines.length < 2) return map;
  const headers = parseCsvLine(lines[0]).map((h) => (h || '').replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim());
  const idIdx = headers.findIndex((h) => h.toLowerCase() === 'id');
  const titleIdx = headers.findIndex((h) => h.toLowerCase() === 'title');
  if (idIdx < 0 || titleIdx < 0) {
    console.warn('[warn] bukkuid CSV missing ID or title column');
    return map;
  }
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const id = (cells[idIdx] || '').replace(/^"|"$/g, '').trim();
    const title = (cells[titleIdx] || '').replace(/^"|"$/g, '').trim();
    if (id && title) map.set(id, title);
  }
  return map;
}

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const bukkuidMap = loadBukkuidIdToTitle(bukkuidPath);
  console.log('Bukkuid id→title rows:', bukkuidMap.size, 'from', bukkuidPath);

  try {
    console.log('[1/4] Normalizing account title typos…');
    await conn.query(
      "UPDATE account SET title = 'Owner Commission' WHERE TRIM(title) = 'Owner Comission'"
    );
    await conn.query(
      "UPDATE account SET title = 'Tenant Commission' WHERE TRIM(title) = 'Tenant Comission'"
    );
    await conn.query(
      "UPDATE account SET title = 'Referral Fees' WHERE TRIM(title) = 'Referal Fees'"
    );
    await conn.query("UPDATE account SET title = 'Parking Fees' WHERE TRIM(title) = 'Parking'");
    await conn.query("UPDATE account SET title = 'Xendit' WHERE TRIM(title) = 'Payex'");

    console.log('[1b] Ensuring canonical template account rows exist (for 0157 FKs)…');
    const ensured = await ensureCanonicalAccounts(conn);
    if (ensured) console.log('  inserted', ensured, 'missing template row(s)');

    console.log('[2/4] Running migration 0157 (dedupe by title → canonical id)…');
    await conn.end();
    execSync(
      `node "${path.join(__dirname, 'run-migration.js')}" "${path.join(
        __dirname,
        '..',
        'src',
        'db',
        'migrations',
        '0157_account_dedupe_canonical_titles.sql'
      )}"`,
      { stdio: 'inherit', cwd: path.join(__dirname, '..') }
    );

    const conn2 = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    });

    console.log('[3/4] Remapping rentalcollection from placeholder accounts…');
    const [placeholders] = await conn2.query(
      'SELECT id FROM account WHERE TRIM(title) = ?',
      [PLACEHOLDER_TITLE]
    );
    let remapped = 0;
    let skipped = 0;
    for (const row of placeholders) {
      const wixId = row.id;
      const rawTitle = bukkuidMap.get(wixId);
      const canonical = canonicalAccountIdForWixTitle(rawTitle);
      if (!canonical) {
        console.warn('[warn] No canonical for placeholder id', wixId, 'title=', rawTitle);
        skipped++;
        continue;
      }
      const [u] = await conn2.query('UPDATE rentalcollection SET type_id = ? WHERE type_id = ?', [
        canonical,
        wixId,
      ]);
      remapped += u.affectedRows || 0;
    }
    console.log('  rentalcollection rows updated:', remapped, 'unresolved placeholders:', skipped);

    console.log('[4/4] Deleting placeholder account rows…');
    const [del] = await conn2.query('DELETE FROM account WHERE TRIM(title) = ?', [PLACEHOLDER_TITLE]);
    console.log('  deleted placeholder account rows:', del.affectedRows);

    await conn2.end();
    console.log('Done.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
