/**
 * 导入 clientdetail CSV。array/object 存 text；pricingplan 用 pricingplan_wixid 上传并解析 pricingplan_id。
 * 用法：node scripts/import-clientdetail.js [csv_path]
 * 默认 csv_path = ./clientdetail.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const JSON5 = require('json5');
const { parse } = require('csv-parse/sync');
const { syncAll, syncSubtablesFromClientdetail } = require('../src/services/client-subtables');
const { createSaasBukkuContact } = require('../src/modules/billing/saas-bukku.service');

/** Convert JS object literal style to JSON: quote unquoted keys and string values. Works without splitting by " so content with quotes is safe. */
function jsLiteralToJson(s) {
  let t = String(s).trim();
  if (!t) return t;
  // Quote $key in MongoDB-style {$date: ...} -> {"$date": ...}
  t = t.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$$$1": ');
  let out = '';
  let i = 0;
  while (i < t.length) {
    if (t[i] === '"') {
      out += t[i];
      i++;
      while (i < t.length && (t[i] !== '"' || (i > 0 && t[i - 1] === '\\'))) out += t[i++];
      if (i < t.length) out += t[i++];
      continue;
    }
    if (/[,{\[]/.test(t[i])) {
      out += t[i++];
      while (i < t.length && /\s/.test(t[i])) out += t[i++];
      if (i < t.length && /[a-zA-Z_$]/.test(t[i])) {
        const keyMatch = t.slice(i).match(/^([a-zA-Z_$][a-zA-Z0-9_]*)\s*:/);
        if (keyMatch) {
          out += '"' + keyMatch[1] + '": ';
          i += keyMatch[0].length;
          continue;
        }
      }
      // not an unquoted key (e.g. digit or "), fall through to output current char
    }
    if (t[i] === ':' && i > 0) {
      out += t[i++];
      while (i < t.length && /\s/.test(t[i])) out += t[i++];
      if (i < t.length) {
        const rest = t.slice(i);
        const numMatch = rest.match(/^(-?\d+\.?\d*)\s*([,\[\]{}])/);
        const wordMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_\-.]*)\s*([,\[\]{}])/);
        if (numMatch) {
          out += numMatch[1] + numMatch[2];
          i += numMatch[0].length;
          continue;
        }
        if (wordMatch) {
          const w = wordMatch[1];
          if (w === 'true' || w === 'false' || w === 'null') {
            out += w + wordMatch[2];
            i += wordMatch[0].length;
            continue;
          }
          out += '"' + w.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' + wordMatch[2];
          i += wordMatch[0].length;
          continue;
        }
        const dateMatch = rest.match(/^(\d{4}-\d{2}-\d{2}T[\d.:+Z\-]+)\s*([,\]}])/);
        if (dateMatch) {
          out += '"' + dateMatch[1] + '"' + dateMatch[2];
          i += dateMatch[0].length;
          continue;
        }
      }
      continue;
    }
    out += t[i++];
  }
  return out;
}

function parseJsonOrJson5(str, debugLabel) {
  if (!str || String(str).trim() === '') return null;
  let s = String(str).trim();
  const debug = process.env.IMPORT_DEBUG === '1';
  try {
    return JSON.parse(s);
  } catch (e1) {
    try {
      return JSON5.parse(s);
    } catch (e2) {
      const converted = jsLiteralToJson(s);
      try {
        return JSON.parse(converted);
      } catch (_) {}
      try {
        return JSON5.parse(converted);
      } catch (__) {}
      const repaired = repairTruncatedJson(converted);
      if (!repaired) {
        if (debug && debugLabel) console.warn('[import-clientdetail] parse failed (no repair):', debugLabel, 'JSON:', e1.message, 'JSON5:', e2.message);
        return null;
      }
      try {
        return JSON.parse(repaired);
      } catch (_) {
        try {
          return JSON5.parse(repaired);
        } catch (e3) {
          if (debug && debugLabel) console.warn('[import-clientdetail] repaired parse failed:', debugLabel, e3.message);
          throw e3;
        }
      }
    }
  }
}

/** Try to close truncated JSON/JSON5 so it can be parsed (e.g. export cut off mid-string). */
function repairTruncatedJson(s) {
  if (!s || typeof s !== 'string') return null;
  const t = s.trim();
  const openB = (t.match(/\[/g) || []).length - (t.match(/\]/g) || []).length;
  const openC = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
  if (openB <= 0 && openC <= 0) return null;
  const last = t.slice(-1);
  let suffix = '';
  if (/[a-zA-Z0-9_]/.test(last)) suffix = ':""';
  else if (last === ':' || last === ',') suffix = '""';
  suffix += '}'.repeat(Math.max(0, openC)) + ']'.repeat(Math.max(0, openB));
  return t + suffix;
}

const csvPath = process.argv[2] || path.join(process.cwd(), 'clientdetail.csv');
const table = 'clientdetail';

const CSV_TO_DB = {
  _id: 'wix_id',
  title: 'title',
  email: 'email',
  status: 'status',
  profilephoto: 'profilephoto',
  subdomain: 'subdomain',
  expired: 'expired',
  pricingplanid: 'pricingplan_wixid',
  currency: 'currency',
  admin: 'admin',
  integration: 'integration',
  profile: 'profile',
  pricingplandetail: 'pricingplandetail',
  credit: 'credit',
  _createdDate: 'created_at',
  _updatedDate: 'updated_at',
  'Created Date': 'created_at',
  'Updated Date': 'updated_at',
};

function splitCsvRows(content) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (cur.trim().length > 0) rows.push(cur);
      cur = '';
      if (c === '\r' && content[i + 1] === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim().length > 0) rows.push(cur);
  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeVal(val) {
  if (val === '' || val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s.toUpperCase() === 'TRUE') return 1;
  if (s.toUpperCase() === 'FALSE') return 0;
  if (/^\d{4}-\d{2}-\d{2}T[\d.:]+Z?$/i.test(s)) {
    return s.replace('T', ' ').replace(/\.\d+Z?$/i, '').replace(/Z$/i, '');
  }
  return s;
}

async function run() {
  const fullPath = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(fullPath)) {
    console.error('File not found:', fullPath);
    console.error('Usage: node scripts/import-clientdetail.js [csv_path]');
    process.exit(1);
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  content = content.replace(/^\uFEFF/, '');
  let records;
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    });
  } catch (e) {
    console.error('CSV parse failed:', e.message);
    process.exit(1);
  }
  if (!records.length) {
    console.error('CSV needs header + at least one data row.');
    process.exit(1);
  }

  const rawHeaders = Object.keys(records[0]);
  const headerToDb = (h) => {
    const trimmed = (h || '').trim();
    const key = CSV_TO_DB[trimmed] || CSV_TO_DB[trimmed.replace(/_date$/i, 'Date')] || trimmed;
    return (key === '_id' ? 'wix_id' : key).toLowerCase().replace(/^\s+|\s+$/g, '');
  };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  const dbName = process.env.DB_NAME;
  const [cols] = await conn.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
    [dbName, table]
  );
  const tableColumns = new Set(cols.map(c => (c.column_name || c.COLUMN_NAME || '').toLowerCase()));

  const [planRows] = await conn.query(
    'SELECT id, wix_id FROM pricingplan WHERE wix_id IS NOT NULL'
  );
  const pricingplanMap = new Map(planRows.map(r => [r.wix_id, r.id]));

  const usedIds = new Set();
  let inserted = 0;

  const debugCsv = process.env.IMPORT_DEBUG === '1';
  try {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const row = {};
      for (const [h, v] of Object.entries(record)) {
        const dbKey = headerToDb(h);
        if (dbKey === '_owner') continue;
        row[dbKey] = v !== undefined && v !== '' ? normalizeVal(v) : null;
      }
      if (i === 0 && debugCsv) {
        const sub = rawHeaders.filter(h => /integration|profile|credit|pricingplan/i.test(String(h)));
        console.warn('[import-clientdetail] row1 subtable columns:', sub.map(h => h + '→len ' + (record[h] != null ? String(record[h]).length : 'undef')).join(', '));
      }

      row.id = (() => {
        let uid;
        do { uid = randomUUID(); } while (usedIds.has(uid));
        usedIds.add(uid);
        return uid;
      })();

      const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      if (!row.created_at) row.created_at = now;
      if (!row.updated_at) row.updated_at = now;
      if (row.status === null || row.status === undefined) row.status = 1;

      const hasData = [row.wix_id, row.email, row.title, row.subdomain].some(
        v => v !== null && v !== undefined && String(v).trim() !== ''
      );
      if (!hasData) continue;

      const pickRaw = (...names) => names.find(n => row[n] != null && String(row[n]).trim() !== '');
      const isHeaderCell = (v) => {
        if (v == null || typeof v !== 'string') return false;
        const t = v.trim().toLowerCase();
        return t === 'integration' || t === 'profile' || t === 'pricingplandetail' || t === 'credit';
      };
      const getSubtableRaws = () => {
        const intK = pickRaw('integration', 'integrations', 'Integration') || Object.keys(row).find(k => /integration/i.test(k) && !/profile/i.test(k));
        const proK = pickRaw('profile', 'Profile') || Object.keys(row).find(k => /^profile$/i.test(k));
        const planK = pickRaw('pricingplandetail', 'pricingplan', 'pricingPlanDetail') || Object.keys(row).find(k => /pricingplan/i.test(k) && !/id|wix|currency/i.test(k));
        const crK = pickRaw('credit', 'Credit') || Object.keys(row).find(k => /^credit$/i.test(k));
        return [intK ? row[intK] : null, proK ? row[proK] : null, planK ? row[planK] : null, crK ? row[crK] : null];
      };
      const [rInt, rPro, rPlan, rCr] = getSubtableRaws();
      if ([rInt, rPro, rPlan, rCr].filter(Boolean).length >= 2 && [rInt, rPro, rPlan, rCr].filter(isHeaderCell).length >= 2) {
        continue;
      }

      if (row.pricingplan_wixid) row.pricingplan_id = pricingplanMap.get(row.pricingplan_wixid) || null;

      const notHeader = (v) => {
        if (v == null || typeof v !== 'string') return v;
        const t = v.trim().toLowerCase();
        if (t === 'integration' || t === 'profile' || t === 'pricingplandetail' || t === 'credit') return null;
        return v;
      };
      let rawIntegration = notHeader(record.integration ?? record.Integration ?? row.integration ?? '');
      let rawProfile = notHeader(record.Profile ?? record.profile ?? row.profile ?? '');
      let rawPricingplandetail = notHeader(record.pricingplandetail ?? record.pricingPlanDetail ?? record.pricingplan ?? row.pricingplandetail ?? row.pricingplan ?? '');
      let rawCredit = notHeader(record.credit ?? record.Credit ?? row.credit ?? '');
      if (typeof rawIntegration === 'string' && !rawIntegration.trim()) rawIntegration = null;
      if (typeof rawProfile === 'string' && !rawProfile.trim()) rawProfile = null;
      if (typeof rawPricingplandetail === 'string' && !rawPricingplandetail.trim()) rawPricingplandetail = null;
      if (typeof rawCredit === 'string' && !rawCredit.trim()) rawCredit = null;

      const hasSubtableColumns = tableColumns.has('integration');
      if (hasSubtableColumns) {
        row.integration = rawIntegration;
        row.profile = rawProfile;
        row.pricingplandetail = rawPricingplandetail;
        row.credit = rawCredit;
      }

      const keys = Object.keys(row).filter(k => tableColumns.has(k.toLowerCase()));
      if (keys.length === 0) continue;

      const colsList = keys.map(k => '`' + k + '`').join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${colsList}) VALUES (${placeholders})`;
      await conn.query(sql, keys.map(k => row[k]));
      inserted++;

      const clientId = row.id;
      const clientWixId = row.wix_id || null;

      if (hasSubtableColumns) {
        await syncSubtablesFromClientdetail(conn, clientId);
        if (rawIntegration || rawProfile || rawPricingplandetail || rawCredit) {
          console.log('[import-clientdetail] Synced subtables from clientdetail (integration/profile/pricingplandetail/credit)');
        }
      } else {
        let integrationArr = null, profileArr = null, pricingplandetailArr = null, creditArr = null;
        try {
          if (rawIntegration && String(rawIntegration).trim()) integrationArr = parseJsonOrJson5(rawIntegration, 'integration');
          if (rawProfile && String(rawProfile).trim()) profileArr = parseJsonOrJson5(rawProfile, 'profile');
          if (rawPricingplandetail && String(rawPricingplandetail).trim()) pricingplandetailArr = parseJsonOrJson5(rawPricingplandetail, 'pricingplandetail');
          if (rawCredit && String(rawCredit).trim()) creditArr = parseJsonOrJson5(rawCredit, 'credit');
        } catch (e) {
          console.warn('[import-clientdetail] JSON/JSON5 parse failed for subtables:', e.message);
        }
        const toArray = (v) => {
          if (v == null) return null;
          if (Array.isArray(v)) return v;
          if (typeof v === 'object' && v !== null) return [v];
          return null;
        };
        integrationArr = toArray(integrationArr);
        profileArr = toArray(profileArr);
        pricingplandetailArr = toArray(pricingplandetailArr);
        creditArr = toArray(creditArr);
        if (Array.isArray(integrationArr) || Array.isArray(profileArr) || Array.isArray(pricingplandetailArr) || Array.isArray(creditArr)) {
          await syncAll(conn, {
            clientId,
            clientWixId,
            integration: integrationArr || undefined,
            profile: profileArr || undefined,
            pricingplandetail: pricingplandetailArr || undefined,
            credit: creditArr || undefined,
          });
          if (integrationArr?.length) console.log('[import-clientdetail] Synced client_integration:', integrationArr.length, 'rows');
          if (profileArr?.length) console.log('[import-clientdetail] Synced client_profile:', profileArr.length, 'rows');
          if (pricingplandetailArr?.length) console.log('[import-clientdetail] Synced client_pricingplan_detail:', pricingplandetailArr.length, 'rows');
          if (creditArr?.length) console.log('[import-clientdetail] Synced client_credit:', creditArr.length, 'rows');
        } else if ([rawIntegration, rawProfile, rawPricingplandetail, rawCredit].some(Boolean)) {
          console.warn('[import-clientdetail] No subtable data - run migration 0002 to add integration/profile/pricingplandetail/credit columns, then re-import.');
        }
      }

      if (tableColumns.has('bukku_saas_contact_id') && process.env.BUKKU_SAAS_API_KEY && process.env.BUKKU_SAAS_SUBDOMAIN) {
        try {
          const legalName = (row.title || '').trim() || `Client ${row.id}`.slice(0, 100);
          const createRes = await createSaasBukkuContact({
            legalName,
            email: row.email ? String(row.email).trim() : undefined,
            defaultCurrencyCode: row.currency ? String(row.currency).toUpperCase() : undefined
          });
          if (createRes.ok && createRes.contactId != null) {
            await conn.query('UPDATE clientdetail SET bukku_saas_contact_id = ?, updated_at = ? WHERE id = ?', [createRes.contactId, now, clientId]);
            if (inserted <= 5) console.log('[import-clientdetail] Bukku contact created for', clientId, '→', createRes.contactId);
          }
        } catch (bukkuErr) {
          console.warn('[import-clientdetail] Bukku contact create failed for', clientId, bukkuErr?.message || bukkuErr);
        }
      }

      if (inserted % 100 === 0) console.log('Inserted', inserted, '...');
    }
    console.log('Done. Inserted', inserted, 'rows into', table);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

run();
