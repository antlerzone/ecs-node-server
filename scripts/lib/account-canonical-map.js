/**
 * MySQL 模板科目：title → canonical account.id（与 0156/0157 一致，不含 Wix CMS 行 id）。
 * Wix 的 CMS 行 UUID 与模板 UUID 常不一致，rentalcollection.type 必须用显式 Wix 行 id → canonical。
 */
const fs = require('fs');
const path = require('path');

const CANONICAL_ACCOUNT_ID_BY_TITLE = {
  'Forfeit Deposit': '2020b22b-028e-4216-906c-c816dcb33a85',
  'Management Fees': 'a1b2c3d4-0002-4000-8000-000000000002',
  Other: '94b4e060-3999-4c76-8189-f969615c0a7d',
  Bank: '1c7e41b6-9d57-4c03-8122-a76baad3b592',
  Cash: 'a1b2c3d4-0001-4000-8000-000000000001',
  Stripe: '26a35506-0631-4d79-9b4f-a8195b69c8ed',
  Xendit: 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10',
  Deposit: '18ba3daf-7208-46fc-8e97-43f34e898401',
  'Platform Collection': 'a1b2c3d4-0003-4000-8000-000000000003',
  'Owner Commission': '86da59c0-992c-4e40-8efd-9d6d793eaf6a',
  'Tenant Commission': 'e1b2c3d4-2002-4000-8000-000000000302',
  'Agreement Fees': 'e1b2c3d4-2003-4000-8000-000000000303',
  'Topup Aircond': 'a1b2c3d4-1001-4000-8000-000000000101',
  'Rental Income': 'ae94f899-7f34-4aba-b6ee-39b97496e2a3',
  'Parking Fees': 'e1b2c3d4-2004-4000-8000-000000000304',
  'Referral Fees': 'e1b2c3d4-2006-4000-8000-000000000306',
  'Processing Fees': 'e1b2c3d4-2007-4000-8000-000000000307',
};

const WIX_TITLE_ALIASES = {
  'owner comission': 'Owner Commission',
  'owner comission (owner)': 'Owner Commission',
  'owner commission (owner)': 'Owner Commission',
  'management fees (owner)': 'Management Fees',
  'management fee (owner)': 'Management Fees',
  'tenant comission': 'Tenant Commission',
  'referal fees': 'Referral Fees',
  parking: 'Parking Fees',
  payex: 'Xendit',
  /** Retired chart rows — resolve to canonical templates. */
  'maintainance fees': 'Other',
  'maintenance fees': 'Other',
  'owner payout': 'Platform Collection',
  'owner account (payout)': 'Platform Collection'
};

const WIX_BUKKUID_ROW_ID_TO_CANONICAL_ID = {
  '18ba3daf-7208-46fc-8e97-43f34e898401': CANONICAL_ACCOUNT_ID_BY_TITLE['Topup Aircond'],
  '1c7e41b6-9d57-4c03-8122-a76baad3b592': CANONICAL_ACCOUNT_ID_BY_TITLE['Forfeit Deposit'],
  '26a35506-0631-4d79-9b4f-a8195b69c8ed': CANONICAL_ACCOUNT_ID_BY_TITLE.Stripe,
  '3411c69c-bfec-4d35-a6b9-27929f9d5bf6': CANONICAL_ACCOUNT_ID_BY_TITLE['Agreement Fees'],
  '620b2d43-4b3a-448f-8a5b-99eb2c3209c7': CANONICAL_ACCOUNT_ID_BY_TITLE['Management Fees'],
  '689a06cc-f770-4a82-8138-79cc02b474d1': CANONICAL_ACCOUNT_ID_BY_TITLE.Cash,
  '8489794b-63a7-4c35-9edb-1403af0bda94': CANONICAL_ACCOUNT_ID_BY_TITLE['Platform Collection'],
  '86da59c0-992c-4e40-8efd-9d6d793eaf6a': CANONICAL_ACCOUNT_ID_BY_TITLE['Owner Commission'],
  '94b4e060-3999-4c76-8189-f969615c0a7d': CANONICAL_ACCOUNT_ID_BY_TITLE['Tenant Commission'],
  'acc54493-2adb-4171-8a02-4b0e2ec85f3b': CANONICAL_ACCOUNT_ID_BY_TITLE.Bank,
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3': CANONICAL_ACCOUNT_ID_BY_TITLE['Rental Income'],
  'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00': CANONICAL_ACCOUNT_ID_BY_TITLE['Parking Fees'],
  'bf502145-6ec8-45bd-a703-13c810cfe186': CANONICAL_ACCOUNT_ID_BY_TITLE.Other,
  'cf4141b1-c24e-4fc1-930e-cfea4329b178': CANONICAL_ACCOUNT_ID_BY_TITLE['Rental Income'],
  'd3f72d51-c791-4ef0-aeec-3ed1134e5c86': CANONICAL_ACCOUNT_ID_BY_TITLE.Deposit,
  'd553cdbe-bc6b-46c2-aba8-f71aceedaf10': CANONICAL_ACCOUNT_ID_BY_TITLE.Xendit,
  'e053b254-5a3c-4b82-8ba0-fd6d0df231d3': CANONICAL_ACCOUNT_ID_BY_TITLE['Platform Collection'],
  'e4fd92bb-de15-4ca0-9c6b-05e410815c58': CANONICAL_ACCOUNT_ID_BY_TITLE['Referral Fees'],
};

function normalizeWixAccountTitle(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  let t = String(raw).trim();
  const lower = t.toLowerCase();
  if (WIX_TITLE_ALIASES[lower]) return WIX_TITLE_ALIASES[lower];
  return t;
}

function canonicalAccountIdForWixTitle(rawTitle) {
  const key = normalizeWixAccountTitle(rawTitle);
  if (!key) return null;
  if (CANONICAL_ACCOUNT_ID_BY_TITLE[key]) return CANONICAL_ACCOUNT_ID_BY_TITLE[key];
  if (CANONICAL_ACCOUNT_ID_BY_TITLE[rawTitle.trim()]) return CANONICAL_ACCOUNT_ID_BY_TITLE[rawTitle.trim()];
  return null;
}

const PLACEHOLDER_TITLE = 'Rental income type (from Wix CSV)';

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

function buildWixAccountIdToCanonicalMap(csvPath) {
  const map = new Map();
  const full = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(full)) return map;
  const lines = splitCsvRows(fs.readFileSync(full, 'utf8'));
  if (lines.length < 2) return map;
  const headers = parseCsvLine(lines[0]).map((h) => (h || '').replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim());
  const idIdx = headers.findIndex((h) => h.toLowerCase() === 'id');
  const titleIdx = headers.findIndex((h) => h.toLowerCase() === 'title');
  if (idIdx < 0 || titleIdx < 0) return map;
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const wixId = (cells[idIdx] || '').replace(/^"|"$/g, '').trim();
    const title = (cells[titleIdx] || '').replace(/^"|"$/g, '').trim();
    if (!wixId || !title) continue;
    const explicit = WIX_BUKKUID_ROW_ID_TO_CANONICAL_ID[wixId];
    if (explicit) {
      map.set(wixId, explicit);
      continue;
    }
    const fromTitle = canonicalAccountIdForWixTitle(title);
    if (fromTitle) map.set(wixId, fromTitle);
  }
  return map;
}

module.exports = {
  CANONICAL_ACCOUNT_ID_BY_TITLE,
  WIX_TITLE_ALIASES,
  WIX_BUKKUID_ROW_ID_TO_CANONICAL_ID,
  normalizeWixAccountTitle,
  canonicalAccountIdForWixTitle,
  PLACEHOLDER_TITLE,
  buildWixAccountIdToCanonicalMap,
};
