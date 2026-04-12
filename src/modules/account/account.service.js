/**
 * Account (SaaS) – accounting settings page: bukkuid list, per-client mapping, save, sync.
 * Migrated from Wix CMS bukkuid + backend/bukku/saveaccount.jsw + syncaccount.jsw.
 * MySQL: account (id, title, type, is_product, uses_platform_collection_gl, account_json), client_integration (addonAccount). (wix_id removed post-0087.)
 * Mapping: bukkuid → account table; bukkuid.account[] → account.account_json (array of { clientId, client_id?, system, accountid, productId }).
 * Parking Fees / Rental Income / Topup Aircond: may save product_id only; GL account comes from Platform Collection (see accountLineMappingRules.js).
 * Only writes when visitor's client account system matches (xero/bukku/autocount/sql).
 */

const crypto = require('crypto');
const pool = require('../../config/db');
const { resolveClnOperatordetailTable } = require('../../config/clnOperatordetailTable');
const xerorequest = require('../xero/wrappers/xerorequest');
const { getValidXeroTokenForCleanlemonOperator } = require('../xero/lib/xeroToken.service');

/** Allowed accounting systems; SQL/AutoCount removed from ECS. */
const ALLOWED_ACCOUNT_PROVIDERS = ['xero', 'bukku'];
const { getAccessContextByEmail } = require('../access/access.service');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const accountWrapper = require('../bukku/wrappers/account.wrapper');
const productWrapper = require('../bukku/wrappers/product.wrapper');
const xeroAccountWrapper = require('../xero/wrappers/account.wrapper');
const xeroItemWrapper = require('../xero/wrappers/item.wrapper');
const autocountAccountWrapper = require('../autocount/wrappers/account.wrapper');
const autocountProductWrapper = require('../autocount/wrappers/product.wrapper');
const sqlaccountAccountWrapper = require('../sqlaccount/wrappers/account.wrapper');
const sqlaccountPaymentMethodWrapper = require('../sqlaccount/wrappers/paymentMethod.wrapper');
const { isIncomeLineUsesPlatformCollectionAccount } = require('./accountLineMappingRules');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function normalizeToken(v) {
  return String(v || '').trim().toLowerCase();
}

async function getClientAccountProvider(clientId) {
  if (!clientId) return '';
  const [intRows] = await pool.query(
    `SELECT provider
       FROM client_integration
      WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1
      LIMIT 1`,
    [clientId]
  );
  return intRows[0] ? String(intRows[0].provider || '').trim().toLowerCase() : '';
}

/**
 * Resolve accounting integration for client (Account/addonAccount).
 * Matches Wix backend/access/accountaccess.jsw: pricing plan gate, integration check, credential extract.
 * Returns { ok, reason?, provider?, credential? }.
 * credential = { token, subdomain } for Bukku/Xero.
 */
async function resolveAccountSystem(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };

  const [clientRows] = await pool.query(
    'SELECT id, title, currency FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!clientRows.length) {
    return { ok: false, reason: 'CLIENT_NOT_FOUND' };
  }

  const [planRows] = await pool.query(
    `SELECT type, plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' LIMIT 1`,
    [clientId]
  );
  const mainPlan = planRows[0] || null;
  if (!mainPlan || !ACCOUNTING_PLAN_IDS.includes(mainPlan.plan_id)) {
    return { ok: false, reason: 'ACCOUNTING_NOT_ALLOWED' };
  }

  const [intRows] = await pool.query(
    `SELECT \`key\`, provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1`,
    [clientId]
  );
  if (!Array.isArray(intRows) || intRows.length === 0) {
    return { ok: false, reason: 'NO_INTEGRATION_CONFIG' };
  }
  const accountIntegration = intRows.find(
    (i) => i.key === 'Account' || i.key === 'addonAccount'
  );
  if (!accountIntegration) {
    return { ok: false, reason: 'ACCOUNT_INTEGRATION_NOT_FOUND' };
  }

  const provider = (accountIntegration.provider || '').toString().trim().toLowerCase();
  if (!provider || !ALLOWED_ACCOUNT_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      reason: 'ACCOUNT_PROVIDER_UNSUPPORTED',
      provider: provider || null
    };
  }

  const values = parseJson(accountIntegration.values_json) || {};
  let credential;
  if (provider === 'bukku') {
    const token = values.bukku_secretKey ?? values.bukku_token;
    const subdomain = values.bukku_subdomain;
    if (!token) return { ok: false, reason: 'BUKKU_TOKEN_MISSING' };
    if (!subdomain) return { ok: false, reason: 'BUKKU_SUBDOMAIN_MISSING' };
    credential = { token: String(token).trim(), subdomain: String(subdomain).trim() };
  } else if (provider === 'xero') {
    const token = values.xero_secretKey ?? values.xero_token;
    const subdomain = values.xero_subdomain;
    if (!token) return { ok: false, reason: 'XERO_TOKEN_MISSING' };
    credential = { token: String(token).trim(), subdomain: subdomain ? String(subdomain).trim() : '' };
  } else {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  }

  return {
    ok: true,
    reason: 'OK',
    provider,
    credential
  };
}

/** Canonical operator chart — migrations 0154 + 0155 (+ 0158 drops Cost of Sales row) */
const PROTECTED_BUKKUID_IDS = [
  '1c7e41b6-9d57-4c03-8122-a76baad3b592', // Bank
  'a1b2c3d4-0001-4000-8000-000000000001', // Cash
  '26a35506-0631-4d79-9b4f-a8195b69c8ed', // Stripe
  'd553cdbe-bc6b-46c2-aba8-f71aceedaf10', // Xendit
  '18ba3daf-7208-46fc-8e97-43f34e898401', // Deposit
  'a1b2c3d4-0003-4000-8000-000000000003', // Platform Collection
  'a1b2c3d4-0002-4000-8000-000000000002', // Management Fees
  '86da59c0-992c-4e40-8efd-9d6d793eaf6a', // Owner Commission
  'e1b2c3d4-2002-4000-8000-000000000302', // Tenant Commission
  'e1b2c3d4-2003-4000-8000-000000000303', // Agreement Fees
  'e1b2c3d4-2008-4000-8000-000000000308', // Admin Charge
  'e1b2c3d4-2009-4000-8000-000000000309', // Cleaning Services
  'a1b2c3d4-1001-4000-8000-000000000101', // Topup Aircond
  '2020b22b-028e-4216-906c-c816dcb33a85', // Forfeit Deposit
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3', // Rental Income
  'e1b2c3d4-2004-4000-8000-000000000304', // Parking Fees
  '94b4e060-3999-4c76-8189-f969615c0a7d', // Other
  'e1b2c3d4-2006-4000-8000-000000000306', // Referral Fees
  'e1b2c3d4-2007-4000-8000-000000000307' // Processing Fees
];

/**
 * When `account` has no rows (e.g. production DB never ran seed migrations), insert canonical
 * templates once. See migrations 0163–0164: Bukku enum or NULL when GL is Platform Collection only.
 */
/**
 * Migration 0215 inserts Billplz after 0163; `type` was seeded as legacy `asset`.
 * DB must store Bukku enum `current_assets` (same as Stripe/Xendit). Idempotent.
 */
async function repairBillplzAccountTemplateType() {
  try {
    await pool.query(
      `UPDATE account SET type = 'current_assets', updated_at = NOW()
       WHERE LOWER(TRIM(COALESCE(title, ''))) = 'billplz'
         AND LOWER(TRIM(COALESCE(type, ''))) IN ('asset', 'assets')`
    );
  } catch (e) {
    console.warn('[account] repairBillplzAccountTemplateType', e?.message || e);
  }
}

async function ensureDefaultAccountTemplatesIfEmpty() {
  try {
    const [c] = await pool.query('SELECT COUNT(*) AS n FROM account');
    const n = Number(c[0]?.n) || 0;
    if (n > 0) return;
    // Forfeit Deposit: type NULL; product line + PC GL (uses_platform_collection_gl=1); cash invoice offsets Deposit.
    const sql = `
INSERT INTO account (id, title, type, is_product, uses_platform_collection_gl, account_json, created_at, updated_at) VALUES
  ('1c7e41b6-9d57-4c03-8122-a76baad3b592', 'Bank', 'current_assets', 0, 0, NULL, NOW(), NOW()),
  ('a1b2c3d4-0001-4000-8000-000000000001', 'Cash', 'current_assets', 0, 0, NULL, NOW(), NOW()),
  ('26a35506-0631-4d79-9b4f-a8195b69c8ed', 'Stripe', 'current_assets', 0, 0, NULL, NOW(), NOW()),
  ('d553cdbe-bc6b-46c2-aba8-f71aceedaf10', 'Xendit', 'current_assets', 0, 0, NULL, NOW(), NOW()),
  ('18ba3daf-7208-46fc-8e97-43f34e898401', 'Deposit', 'current_liabilities', 1, 0, NULL, NOW(), NOW()),
  ('a1b2c3d4-0003-4000-8000-000000000003', 'Platform Collection', 'current_liabilities', 0, 0, NULL, NOW(), NOW()),
  ('a1b2c3d4-0002-4000-8000-000000000002', 'Management Fees', 'income', 1, 0, NULL, NOW(), NOW()),
  ('86da59c0-992c-4e40-8efd-9d6d793eaf6a', 'Owner Commission', 'income', 1, 0, NULL, NOW(), NOW()),
  ('e1b2c3d4-2002-4000-8000-000000000302', 'Tenant Commission', 'income', 1, 0, NULL, NOW(), NOW()),
  ('e1b2c3d4-2003-4000-8000-000000000303', 'Agreement Fees', 'income', 1, 0, NULL, NOW(), NOW()),
  ('e1b2c3d4-2008-4000-8000-000000000308', 'Admin Charge', 'income', 1, 0, NULL, NOW(), NOW()),
  ('a1b2c3d4-1001-4000-8000-000000000101', 'Topup Aircond', NULL, 1, 1, NULL, NOW(), NOW()),
  ('2020b22b-028e-4216-906c-c816dcb33a85', 'Forfeit Deposit', NULL, 1, 1, NULL, NOW(), NOW()),
  ('ae94f899-7f34-4aba-b6ee-39b97496e2a3', 'Rental Income', NULL, 1, 1, NULL, NOW(), NOW()),
  ('e1b2c3d4-2004-4000-8000-000000000304', 'Parking Fees', NULL, 1, 1, NULL, NOW(), NOW()),
  ('94b4e060-3999-4c76-8189-f969615c0a7d', 'Other', NULL, 1, 1, NULL, NOW(), NOW()),
  ('e1b2c3d4-2006-4000-8000-000000000306', 'Referral Fees', 'cost_of_sales', 1, 0, NULL, NOW(), NOW()),
  ('e1b2c3d4-2007-4000-8000-000000000307', 'Processing Fees', 'cost_of_sales', 1, 0, NULL, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  type = VALUES(type),
  is_product = VALUES(is_product),
  uses_platform_collection_gl = VALUES(uses_platform_collection_gl),
  updated_at = NOW()`;
    await pool.query(sql);
    console.log('[account] ensureDefaultAccountTemplatesIfEmpty: seeded 17 default templates');
  } catch (e) {
    console.warn('[account] ensureDefaultAccountTemplatesIfEmpty failed', e?.message || e);
  }
}

/**
 * List account templates (bukkuid) with _myAccount for current client. Sorted by title.
 * Uses account_client junction (indexed) for fast lookup; falls back to account_json if no junction row.
 */
async function listAccountTemplates(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    throw new Error('NO_EMAIL');
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    throw new Error('NO_PERMISSION');
  }
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT');
  const provider = await getClientAccountProvider(clientId);

  await ensureDefaultAccountTemplatesIfEmpty();
  await repairBillplzAccountTemplateType();

  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.type, a.is_product, a.uses_platform_collection_gl, a.account_json,
            ac.\`system\` AS ac_system, ac.accountid AS ac_accountid, ac.product_id AS ac_product_id
     FROM account a
     LEFT JOIN account_client ac ON ac.account_id = a.id AND ac.client_id = ? AND ac.\`system\` = ?
     ORDER BY a.title ASC`,
    [clientId, provider]
  );

  return rows.map((row) => {
    let myAccount = null;
    const hasAc = row.ac_accountid != null && String(row.ac_accountid).trim() !== '';
    const hasPr = row.ac_product_id != null && String(row.ac_product_id).trim() !== '';
    if (hasAc || hasPr) {
      myAccount = {
        clientId: clientId,
        system: row.ac_system || 'bukku',
        accountid: hasAc ? String(row.ac_accountid).trim() : '',
        productId: hasPr ? String(row.ac_product_id).trim() : ''
      };
      if (!hasAc && hasPr && isIncomeLineUsesPlatformCollectionAccount(row.id)) {
        myAccount._accountFromPlatformCollection = true;
      }
    } else {
      const accountArr = parseJson(row.account_json);
      const arr = Array.isArray(accountArr) ? accountArr : [];
      const a = arr.find(
        (x) => x
          && (x.clientId === clientId || x.client_id === clientId)
          && (!provider || String(x.system || x.provider || '').toLowerCase() === provider)
      );
      if (a) {
        myAccount = {
          clientId: a.clientId || a.client_id,
          system: a.system,
          accountid: a.accountid,
          productId: a.productId
        };
      }
    }
    const isProtected = PROTECTED_BUKKUID_IDS.includes(row.id);
    return {
      _id: row.id,
      id: row.id,
      title: row.title,
      type: row.type,
      is_product: row.is_product === 1 || row.is_product === true,
      uses_platform_collection_gl:
        row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true,
      _myAccount: myAccount,
      _protected: isProtected
    };
  });
}

/**
 * Get one account template by id with _myAccount for current client. Uses account_client junction when present.
 */
async function getAccountById(email, accountId) {
  if (!email || !accountId) throw new Error('NO_EMAIL_OR_ID');
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) throw new Error(ctx.reason || 'ACCESS_DENIED');
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    throw new Error('NO_PERMISSION');
  }
  const clientId = ctx.client?.id;
  if (!clientId) throw new Error('NO_CLIENT');
  const provider = await getClientAccountProvider(clientId);

  const [rows] = await pool.query(
    `SELECT a.id, a.title, a.type, a.is_product, a.uses_platform_collection_gl, a.account_json,
            ac.\`system\` AS ac_system, ac.accountid AS ac_accountid, ac.product_id AS ac_product_id
     FROM account a
     LEFT JOIN account_client ac ON ac.account_id = a.id AND ac.client_id = ? AND ac.\`system\` = ?
     WHERE a.id = ? LIMIT 1`,
    [clientId, provider, accountId]
  );
  if (!rows.length) throw new Error('NOT_FOUND');

  const row = rows[0];
  let myAccount = null;
  const hasAc = row.ac_accountid != null && String(row.ac_accountid).trim() !== '';
  const hasPr = row.ac_product_id != null && String(row.ac_product_id).trim() !== '';
  if (hasAc || hasPr) {
    myAccount = {
      clientId: clientId,
      system: row.ac_system || 'bukku',
      accountid: hasAc ? String(row.ac_accountid).trim() : '',
      productId: hasPr ? String(row.ac_product_id).trim() : ''
    };
    if (!hasAc && hasPr && isIncomeLineUsesPlatformCollectionAccount(row.id)) {
      myAccount._accountFromPlatformCollection = true;
    }
  } else {
    const accountArr = parseJson(row.account_json);
    const arr = Array.isArray(accountArr) ? accountArr : [];
    const a = arr.find(
      (x) => x
        && (x.clientId === clientId || x.client_id === clientId)
        && (!provider || String(x.system || x.provider || '').toLowerCase() === provider)
    );
    if (a) {
      myAccount = {
        clientId: a.clientId || a.client_id,
        system: a.system,
        accountid: a.accountid,
        productId: a.productId
      };
    }
  }
  const isProtected = PROTECTED_BUKKUID_IDS.includes(row.id);

  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    type: row.type,
    is_product: row.is_product === 1 || row.is_product === true,
    uses_platform_collection_gl:
      row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true,
    _myAccount: myAccount,
    _protected: isProtected
  };
}

/**
 * Save client mapping for one account template. Only allows system = visitor's client account provider (xero/bukku/autocount/sql).
 * 只寫入 account_client，不再寫入 account.account_json。
 * Params: { item: { _id }, clientId, system, accountId?, productId? }.
 */
async function saveBukkuAccount(email, params) {
  const { item, clientId, system, accountId, productId } = params || {};
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const resolvedClientId = ctx.client?.id;
  if (!resolvedClientId || resolvedClientId !== clientId) {
    return { ok: false, reason: 'CLIENT_MISMATCH' };
  }
  if (!item || !item._id || !clientId || !system) {
    return { ok: false, reason: 'INVALID_PARAMS' };
  }

  const provider = (system || '').toString().trim().toLowerCase();
  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const clientProvider = intRows[0] ? (intRows[0].provider || '').toString().trim().toLowerCase() : '';
  if (!ALLOWED_ACCOUNT_PROVIDERS.includes(provider) || provider !== clientProvider) {
    return { ok: false, reason: 'SYSTEM_MISMATCH', message: 'system must match client account integration (xero/bukku/autocount/sql)' };
  }

  const [rows] = await pool.query('SELECT id FROM account WHERE id = ? LIMIT 1', [item._id]);
  if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };

  const emptyAccount = !accountId || String(accountId).trim() === '';
  const hasProduct = productId != null && String(productId).trim() !== '';

  if (emptyAccount && !hasProduct) {
    await pool.query(
      'DELETE FROM account_client WHERE account_id = ? AND client_id = ? AND `system` = ?',
      [item._id, resolvedClientId, provider]
    );
    return { ok: true, reason: 'DELETED' };
  }

  const productIdVal = hasProduct ? String(productId).trim() : null;

  if (emptyAccount && hasProduct && isIncomeLineUsesPlatformCollectionAccount(item._id)) {
    await pool.query(
      `INSERT INTO account_client (account_id, client_id, \`system\`, accountid, product_id)
       VALUES (?, ?, ?, NULL, ?)
       ON DUPLICATE KEY UPDATE accountid = NULL, product_id = VALUES(product_id), updated_at = NOW()`,
      [item._id, resolvedClientId, provider, productIdVal]
    );
    return { ok: true, reason: 'UPDATED' };
  }

  if (emptyAccount) {
    await pool.query(
      'DELETE FROM account_client WHERE account_id = ? AND client_id = ? AND `system` = ?',
      [item._id, resolvedClientId, provider]
    );
    return { ok: true, reason: 'DELETED' };
  }

  await pool.query(
    `INSERT INTO account_client (account_id, client_id, \`system\`, accountid, product_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE accountid = VALUES(accountid), product_id = VALUES(product_id), updated_at = NOW()`,
    [item._id, resolvedClientId, provider, String(accountId).trim(), productIdVal]
  );
  return { ok: true, reason: 'UPDATED' };
}

function normalize(str) {
  return String(str || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Bukku list/create may use snake_case or PascalCase; list payload sometimes uses other keys. */
function bukkuAccountName(x) {
  if (x == null || typeof x !== 'object') return '';
  const n =
    x.name ??
    x.Name ??
    x.account_name ??
    x.AccountName ??
    x.accountName ??
    x.title ??
    x.Title ??
    x.label ??
    x.Label;
  return n != null ? String(n) : '';
}

function extractAccountsArrayFromBukkuListResponse(res) {
  if (!res || !res.ok || res.data == null) return [];
  const d = res.data;
  if (Array.isArray(d.accounts)) return d.accounts;
  if (Array.isArray(d.data?.accounts)) return d.data.accounts;
  if (Array.isArray(d.Data?.Accounts)) return d.Data.Accounts;
  if (Array.isArray(d)) return d;
  return [];
}

/** Chart may nest sub-accounts (e.g. 1000-00 under 1000). */
function flattenBukkuAccountTree(nodes) {
  const out = [];
  if (!Array.isArray(nodes)) return out;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    out.push(node);
    const kids =
      node.children ??
      node.Children ??
      node.sub_accounts ??
      node.subAccounts ??
      node.SubAccounts;
    if (Array.isArray(kids) && kids.length) out.push(...flattenBukkuAccountTree(kids));
  }
  return out;
}

function mergeBukkuAccountsById(base, extra) {
  const map = new Map();
  for (const a of base) {
    const id = a?.id ?? a?.Id;
    if (id != null) map.set(String(id), a);
  }
  for (const a of extra) {
    const id = a?.id ?? a?.Id;
    if (id != null && !map.has(String(id))) map.set(String(id), a);
  }
  return Array.from(map.values());
}

/**
 * Full list may omit bank/cash rows depending on API defaults; search + assets category fill gaps.
 */
async function augmentBukkuAccountsIfMissingBankCashDefaults(req, accounts) {
  const haveBank = findBukkuBankAccountDefaultInList(accounts);
  const haveCash = findBukkuCashOnHandInList(accounts);
  if (haveBank && haveCash) return accounts;

  let merged = accounts;
  const tryMerge = (res) => {
    if (!res || !res.ok) return;
    const raw = extractAccountsArrayFromBukkuListResponse(res);
    const flat = flattenBukkuAccountTree(raw);
    if (flat.length) merged = mergeBukkuAccountsById(merged, flat);
  };

  if (!haveBank) {
    tryMerge(await accountWrapper.list(req, { search: 'Bank Account', page_size: BUKKU_LIST_PAGE_SIZE }));
  }
  if (!haveCash) {
    tryMerge(await accountWrapper.list(req, { search: 'Cash on Hand', page_size: BUKKU_LIST_PAGE_SIZE }));
  }
  if (!findBukkuBankAccountDefaultInList(merged) || !findBukkuCashOnHandInList(merged)) {
    tryMerge(await accountWrapper.list(req, { category: 'assets', page_size: BUKKU_LIST_PAGE_SIZE }));
  }
  return merged;
}

function bukkuProductName(p) {
  const n = p?.name ?? p?.Name;
  return n != null ? String(n) : '';
}

function bukkuAccountTypeRaw(x) {
  const t = x?.type ?? x?.Type ?? x?.account_type ?? x?.AccountType;
  return t != null ? String(t).trim() : '';
}

/**
 * Compare POST /accounts `type` enum: snake_case, hyphens, spaces, and camelCase (e.g. currentAssets).
 */
function normalizeBukkuAccountTypeKey(str) {
  let s = String(str || '').trim();
  s = s.replace(/-/g, '_').replace(/\s+/g, '_');
  s = s.replace(/([a-z])([A-Z])/g, '$1_$2');
  return s.replace(/_+/g, '_').toLowerCase();
}

/**
 * Template `type` from DB vs remote row. `system_type` bank_cash implies current_assets GL in Bukku.
 */
function remoteAccountTypeMatchesTemplate(account, expectedTyKey) {
  if (!expectedTyKey) return false;
  const raw = bukkuAccountTypeRaw(account);
  const key = raw !== '' ? normalizeBukkuAccountTypeKey(raw) : '';
  if (key !== '' && key === expectedTyKey) return true;
  const st = account?.system_type ?? account?.SystemType;
  if (expectedTyKey === 'current_assets' && st === 'bank_cash') return true;
  return false;
}

/** Edit distance for short chart/product names (typos like Referal / referall). */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function fuzzyNameMaxEditDistance(maxLen) {
  if (maxLen <= 3) return 0;
  if (maxLen <= 5) return 1; // e.g. bank vs blank (2) — no match; short words stay strict
  if (maxLen <= 12) return 2; // e.g. referral vs referall (2)
  if (maxLen <= 24) return 2;
  return Math.min(3, Math.floor(maxLen * 0.12));
}

/** True if `d` is an acceptable fuzzy match between normalized names (guards very short words). */
function fuzzyNamePairOk(keyNorm, remoteNorm, d) {
  if (d === 0) return true;
  const maxLen = Math.max(keyNorm.length, remoteNorm.length);
  if (maxLen <= 4) return false;
  return d <= fuzzyNameMaxEditDistance(maxLen);
}

function findBestFuzzyAccountByKeys(accounts, normalizedKeys, getNameFn = bukkuAccountName) {
  let best = null;
  let bestDist = Infinity;
  for (const x of accounts) {
    const xn = normalize(getNameFn(x));
    if (!xn) continue;
    for (const key of normalizedKeys) {
      if (!key) continue;
      const d = levenshtein(key, xn);
      if (!fuzzyNamePairOk(key, xn, d)) continue;
      if (d < bestDist) {
        bestDist = d;
        best = x;
      }
    }
  }
  return best;
}

/** Bukku balance-sheet `type` values — `classification` applies to these only. */
const BUKKU_BALANCE_SHEET_TYPES = new Set([
  'current_assets',
  'non_current_assets',
  'other_assets',
  'current_liabilities',
  'non_current_liabilities',
  'equity'
]);

/**
 * Map legacy `account.type` from DB to Bukku POST /accounts enum (snake_case).
 * e.g. migration 0215 seeded Billplz as `asset`; Bukku rejects it — use current_assets like Stripe/Xendit.
 */
function mapDbAccountTypeToBukkuApi(typeFromDb) {
  let t = String(typeFromDb || '').trim();
  const tl = t.toLowerCase();
  // Legacy DB tokens (see migration 0163); must match POST /accounts enum for sync + create.
  if (tl === 'asset' || tl === 'assets') return 'current_assets';
  return t;
}

/**
 * Body for POST /accounts — matches Bukku API enum + optional system_type / classification.
 * Bank & Cash clearing accounts use system_type bank_cash with type current_assets.
 * `currency_code` (ISO 4217) is required by Bukku for many account types (e.g. bank_cash).
 */
function buildBukkuAccountCreatePayload(title, typeFromDb, currencyCode) {
  const name = String(title || '').trim();
  const type = mapDbAccountTypeToBukkuApi(typeFromDb);
  const payload = { name, type };
  const raw = currencyCode;
  if (raw == null || String(raw).trim() === '') throw new Error('MISSING_CLIENT_CURRENCY');
  const cc = String(raw).trim().toUpperCase();
  payload.currency_code = cc;
  if (BUKKU_BALANCE_SHEET_TYPES.has(type)) {
    payload.classification = 'OPERATING';
  }
  const nt = normalize(name);
  if (type === 'current_assets' && (nt === 'bank' || nt === 'cash')) {
    payload.system_type = 'bank_cash';
  }
  return payload;
}

/** Bukku POST /products: when is_selling is true, sale_account_id is required (links product to GL). */
function buildBukkuProductCreateBody(title, saleAccountId) {
  const name = String(title || '').trim();
  const sid = saleAccountId != null && String(saleAccountId).trim() !== '' ? Number(saleAccountId) : NaN;
  const body = {
    name,
    is_selling: true,
    is_buying: false,
    track_inventory: false,
    units: [{
      label: 'unit',
      rate: 1,
      sale_price: 0,
      is_base: true,
      is_sale_default: true,
      is_purchase_default: false
    }]
  };
  if (!Number.isNaN(sid)) {
    body.sale_account_id = sid;
  }
  return body;
}

function bukkuRemoteId(entity) {
  if (entity == null) return null;
  const id = entity.id ?? entity.Id;
  return id != null ? id : null;
}

/**
 * Bukku chart: template **Bank** maps only to **Bank Account**; template **Cash** only to **Cash on Hand**
 * (see findBukkuBankAccountDefaultInList / findBukkuCashOnHandInList). Other titles use aliases as before.
 */
function bukkuAccountTitleAliases(title) {
  const t = normalize(title);
  if (t === 'bank' || t === 'cash') {
    return [];
  }
  return [t];
}

/** Bank template must not map to Cash on Hand; Cash template must not map to Bank Account. */
function rejectBankCashMismatch(templateNorm, account) {
  const rn = normalize(bukkuAccountName(account));
  if (!rn) return false;
  if (templateNorm === 'bank') {
    if (rn === 'cash on hand' || rn.includes('cash on hand') || rn === 'petty cash') return true;
  }
  if (templateNorm === 'cash') {
    if (rn === 'bank account' || rn === 'bank accounts') return true;
  }
  return false;
}

/**
 * Resolve by **name only** (Bukku list may omit or vary `type` / `system_type`).
 * Cash template → **Cash on Hand** only.
 */
function findBukkuCashOnHandInList(bukkuAccounts) {
  if (!Array.isArray(bukkuAccounts)) return null;
  for (const x of bukkuAccounts) {
    if (normalize(bukkuAccountName(x)) === 'cash on hand') return x;
  }
  return null;
}

/** Bank template → **Bank Account** only. */
function findBukkuBankAccountDefaultInList(bukkuAccounts) {
  if (!Array.isArray(bukkuAccounts)) return null;
  for (const x of bukkuAccounts) {
    if (normalize(bukkuAccountName(x)) === 'bank account') return x;
  }
  return null;
}

/**
 * Match remote chart accounts only when Bukku `type` matches the template (e.g. current_assets with
 * current_assets; cost_of_sales with cost_of_sales). Same spelling in a different type must not
 * reuse (e.g. name like "Cost of Sales" under asset vs under expense).
 * Order: exact name (incl. bank/cash aliases) + type → fuzzy name + same type only.
 */
function findExistingBukkuAccount(bukkuAccounts, title, bukkuType) {
  const tyKey = normalizeBukkuAccountTypeKey(bukkuType);
  const templateNorm = normalize(title);
  if (templateNorm === 'cash' && tyKey === 'current_assets') {
    return findBukkuCashOnHandInList(bukkuAccounts);
  }
  if (templateNorm === 'bank' && tyKey === 'current_assets') {
    return findBukkuBankAccountDefaultInList(bukkuAccounts);
  }

  const aliases = bukkuAccountTitleAliases(title);
  if (!aliases.length || !aliases[0]) return null;
  const withType = bukkuAccounts.filter((x) => remoteAccountTypeMatchesTemplate(x, tyKey));
  const pool = withType.filter((x) => !rejectBankCashMismatch(templateNorm, x));

  for (const name of aliases) {
    if (!name) continue;
    const a = pool.find((x) => normalize(bukkuAccountName(x)) === name);
    if (a) return a;
  }
  const keys = [...new Set(aliases.map((n) => normalize(n)).filter(Boolean))];
  return findBestFuzzyAccountByKeys(pool, keys);
}

/**
 * If typed match fails but Bukku already has a row with the same name (type label may differ in API),
 * link by name to avoid POST duplicate name errors.
 */
function findBukkuAccountByExactNameAnyType(bukkuAccounts, title) {
  if (!Array.isArray(bukkuAccounts)) return null;
  const templateNorm = normalize(title);
  const aliases = bukkuAccountTitleAliases(title);
  const keys = [...new Set([templateNorm, ...aliases.map((a) => normalize(a))].filter(Boolean))];
  // Template titles "Bank"/"Cash" have empty aliases; Bukku defaults are "Bank Account" / "Cash on Hand".
  if (templateNorm === 'bank') keys.push('bank account');
  if (templateNorm === 'cash') keys.push('cash on hand');
  if (!keys.length) return null;
  for (const x of bukkuAccounts) {
    if (rejectBankCashMismatch(templateNorm, x)) continue;
    const rn = normalize(bukkuAccountName(x));
    if (!rn) continue;
    if (keys.some((k) => k === rn)) return x;
  }
  return null;
}

function findExistingBukkuProduct(bukkuProducts, title) {
  const t = normalize(title);
  if (!t) return null;
  const exact = bukkuProducts.find((p) => normalize(bukkuProductName(p)) === t);
  if (exact) return exact;
  return findBestFuzzyAccountByKeys(bukkuProducts, [t], bukkuProductName);
}

/** Bukku GET /accounts and /products are paginated; one call often returns only the first page. */
const BUKKU_LIST_PAGE_SIZE = 100;

async function fetchAllBukkuAccountsFlat(req) {
  const merged = [];
  let lastFirstKey = null;
  for (let page = 1; page <= 200; page++) {
    let res = await accountWrapper.list(req, { page, page_size: BUKKU_LIST_PAGE_SIZE });
    if (!res.ok && page === 1) {
      res = await accountWrapper.list(req, {});
    }
    if (!res.ok) {
      if (page === 1) {
        console.warn('[account] Bukku GET /accounts failed', res.status, res.error);
      }
      break;
    }
    const accounts = flattenBukkuAccountTree(extractAccountsArrayFromBukkuListResponse(res));
    if (!accounts.length) break;
    const first = accounts[0];
    const key = first != null ? `${first.id ?? first.Id ?? ''}:${normalize(bukkuAccountName(first))}` : null;
    if (page > 1 && key != null && key === lastFirstKey) {
      console.warn('[account] Bukku /accounts list appears to ignore page param; using first page only');
      break;
    }
    lastFirstKey = key;
    merged.push(...accounts);
    if (accounts.length < BUKKU_LIST_PAGE_SIZE) break;
  }
  return merged;
}

async function fetchAllBukkuProductsFlat(req) {
  const merged = [];
  let lastFirstKey = null;
  for (let page = 1; page <= 200; page++) {
    let res = await productWrapper.list(req, { page, page_size: BUKKU_LIST_PAGE_SIZE });
    if (!res.ok && page === 1) {
      res = await productWrapper.list(req, {});
    }
    if (!res.ok) {
      if (page === 1) {
        console.warn('[account] Bukku GET /products failed', res.status, res.error);
      }
      break;
    }
    const products = Array.isArray(res.data?.products)
      ? res.data.products
      : Array.isArray(res.data)
        ? res.data
        : [];
    if (!products.length) break;
    const first = products[0];
    const key = first != null ? `${first.id ?? first.Id ?? ''}:${normalize(bukkuProductName(first))}` : null;
    if (page > 1 && key != null && key === lastFirstKey) {
      console.warn('[account] Bukku /products list appears to ignore page param; using first page only');
      break;
    }
    lastFirstKey = key;
    merged.push(...products);
    if (products.length < BUKKU_LIST_PAGE_SIZE) break;
  }
  return merged;
}

/**
 * Sync Bukku: for each account row create/link Bukku account and product, then save mapping.
 * Uses client_integration (addonAccount, bukku) for token; requires accounting capability.
 */
async function syncBukkuAccounts(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };

  const [planRows] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
    [clientId, 'plan']
  );
  const planId = planRows[0]?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) {
    return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };
  }

  const [intRows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'bukku' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!intRows.length) return { ok: false, reason: 'NOT_BUKKU_PROVIDER' };
  const values = parseJson(intRows[0].values_json) || {};
  const token = values.bukku_secretKey || values.bukku_token;
  const subdomain = values.bukku_subdomain;
  if (!token || !subdomain) return { ok: false, reason: 'NO_CREDENTIALS' };

  await repairBillplzAccountTemplateType();

  const req = { client: { bukku_secretKey: token, bukku_subdomain: subdomain } };

  const [[currencyRow]] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
  const rawCompanyCurrency = currencyRow?.currency;
  if (rawCompanyCurrency == null || String(rawCompanyCurrency).trim() === '') throw new Error('MISSING_CLIENT_CURRENCY');
  const companyCurrency = String(rawCompanyCurrency).trim().toUpperCase();

  try {
    let bukkuAccounts;
    let bukkuProducts;
    [bukkuAccounts, bukkuProducts] = await Promise.all([
      fetchAllBukkuAccountsFlat(req),
      fetchAllBukkuProductsFlat(req)
    ]);
    bukkuAccounts = await augmentBukkuAccountsIfMissingBankCashDefaults(req, bukkuAccounts);

    const [accountRows] = await pool.query(
      'SELECT id, title, type, is_product, uses_platform_collection_gl, account_json FROM account ORDER BY title ASC'
    );

    let createdAccounts = 0;
    /** Reused existing remote account (no create). */
    let linkedAccounts = 0;
    let createdProducts = 0;
    /** Reused existing remote product (no create). */
    let linkedProducts = 0;
    let saveMappingFailed = 0;
    /** Short human messages for operator (capped). */
    const warnings = [];

    function warn(msg) {
      if (warnings.length < 30) warnings.push(msg);
    }

    /** Platform–collection product lines need sale_account_id → ensure Platform Collection GL exists in Bukku first. */
    const PLATFORM_TITLE = 'Platform Collection';
    const PLATFORM_TYPE = 'current_liabilities';
    let platformCollectionAccount = findExistingBukkuAccount(bukkuAccounts, PLATFORM_TITLE, PLATFORM_TYPE);
    if (!platformCollectionAccount) {
      const pcr = await accountWrapper.create(
        req,
        buildBukkuAccountCreatePayload(PLATFORM_TITLE, PLATFORM_TYPE, companyCurrency)
      );
      if (pcr.ok) {
        platformCollectionAccount = pcr.data?.account || pcr.data;
        if (platformCollectionAccount) {
          bukkuAccounts.push(platformCollectionAccount);
          createdAccounts++;
        }
      } else {
        warn(
          `"${PLATFORM_TITLE}": could not create in Bukku — ${JSON.stringify(pcr.error || pcr).slice(0, 220)}`
        );
      }
    }
    const platformSaleAccountId = bukkuRemoteId(platformCollectionAccount);

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const usePlatformGl = row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true;
      const isProd = row.is_product === 1 || row.is_product === true;
      const bukkuType = String(row.type || '').trim();

      /** Product + GL via Platform Collection: sync product only; accountid NULL (see saveBukkuAccount + accountLineMappingRules). */
      if (usePlatformGl && isProd) {
        let productId = null;
        let existingProduct = findExistingBukkuProduct(bukkuProducts, title);
        if (!existingProduct) {
          if (platformSaleAccountId == null) {
            warn(`Product "${title}": skipped — Platform Collection account missing in Bukku`);
          } else {
            const createProductRes = await productWrapper.create(
              req,
              buildBukkuProductCreateBody(title, platformSaleAccountId)
            );
            if (createProductRes.ok) {
              existingProduct = createProductRes.data?.product || createProductRes.data;
              if (existingProduct) {
                bukkuProducts.push(existingProduct);
                createdProducts++;
              }
            } else {
              warn(
                `Product "${title}": create failed — ${JSON.stringify(createProductRes.error || createProductRes).slice(0, 280)}`
              );
            }
          }
        } else {
          linkedProducts++;
        }
        if (existingProduct) {
          productId = String(existingProduct.id);
        }
        if (productId) {
          const saveRes = await saveBukkuAccount(email, {
            item: { _id: row.id },
            clientId,
            system: 'bukku',
            accountId: null,
            productId
          });
          if (!saveRes.ok) {
            saveMappingFailed += 1;
            warn(`Product "${title}": save mapping failed — ${saveRes.reason || 'unknown'}`);
          }
        }
        continue;
      }

      if (!bukkuType) continue;

      // DB may still store legacy `asset`; POST maps it to current_assets. Matching must use the same
      // normalization or "Bank"/"Cash" fail to find Bukku defaults and POST duplicate GL rows.
      const bukkuTypeNormalized = mapDbAccountTypeToBukkuApi(bukkuType);

      let existingAccount = findExistingBukkuAccount(bukkuAccounts, title, bukkuTypeNormalized);
      if (!existingAccount) {
        const byName = findBukkuAccountByExactNameAnyType(bukkuAccounts, title);
        if (byName) {
          existingAccount = byName;
          warn(
            `Account "${title}": linked existing Bukku account by name (GL type in Bukku may differ from template type "${bukkuType}").`
          );
        }
      }
      if (!existingAccount) {
        if (normalize(title) === 'cash' && bukkuTypeNormalized === 'current_assets') {
          warn(
            'Account "Cash": no "Cash on Hand" in Bukku list — skipped POST (do not create a duplicate "Cash" GL).'
          );
          continue;
        }
        if (normalize(title) === 'bank' && bukkuTypeNormalized === 'current_assets') {
          warn(
            'Account "Bank": no "Bank Account" in Bukku list — skipped POST (map template to Bukku default "Bank Account" only).'
          );
          continue;
        }
        const createRes = await accountWrapper.create(
          req,
          buildBukkuAccountCreatePayload(title, bukkuType, companyCurrency)
        );
        if (!createRes.ok) {
          warn(
            `Account "${title}": create failed — ${JSON.stringify(createRes.error || createRes).slice(0, 280)}`
          );
          continue;
        }
        existingAccount = createRes.data?.account || createRes.data;
        if (existingAccount) {
          bukkuAccounts.push(existingAccount);
          createdAccounts++;
        }
      } else {
        linkedAccounts++;
      }
      if (!existingAccount) continue;

      let productId = null;
      if (row.is_product === 1 || row.is_product === true) {
        let existingProduct = findExistingBukkuProduct(bukkuProducts, title);
        if (!existingProduct) {
          const saleAcc = bukkuRemoteId(existingAccount);
          const createProductRes = await productWrapper.create(req, buildBukkuProductCreateBody(title, saleAcc));
          if (createProductRes.ok) {
            existingProduct = createProductRes.data?.product || createProductRes.data;
            if (existingProduct) {
              bukkuProducts.push(existingProduct);
              createdProducts++;
            }
          } else {
            warn(
              `Product "${title}": create failed — ${JSON.stringify(createProductRes.error || createProductRes).slice(0, 280)}`
            );
          }
        } else {
          linkedProducts++;
        }
        if (existingProduct) {
          productId = String(existingProduct.id);
        }
      }

      const saveRes = await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'bukku',
        accountId: String(existingAccount.id),
        productId
      });
      if (!saveRes.ok) {
        saveMappingFailed += 1;
        warn(`Account "${title}": save mapping failed — ${saveRes.reason || 'unknown'}`);
      }
    }

    return {
      ok: true,
      provider: 'bukku',
      createdAccounts,
      linkedAccounts,
      createdProducts,
      linkedProducts,
      saveMappingFailed,
      warnings: warnings.length ? warnings : undefined
    };
  } catch (err) {
    console.error('[account] syncBukkuAccounts', err);
    return { ok: false, reason: 'SYNC_BUKKU_FAILED', message: err.message };
  }
}

/** Map account.type (Bukku POST /accounts enum, snake_case) to Xero Account Type */
const BUKKU_TO_XERO_TYPE = {
  income: 'REVENUE',
  other_income: 'OTHERINCOME',
  revenue: 'REVENUE',
  revenue_type: 'REVENUE',
  expenses: 'EXPENSE',
  expense: 'EXPENSE',
  expense_type: 'EXPENSE',
  taxation: 'EXPENSE',
  cost_of_sales: 'DIRECTCOSTS',
  current_assets: 'CURRENT',
  non_current_assets: 'FIXED',
  other_assets: 'CURRENT',
  current_liabilities: 'CURRLIAB',
  non_current_liabilities: 'LIABILITY',
  equity: 'EQUITY',
  bank: 'BANK',
  current_asset: 'CURRENT',
  current_liability: 'CURRLIAB',
  currliab: 'CURRLIAB',
  fixed: 'FIXED',
  liability: 'LIABILITY',
  sales: 'SALES',
  otherincome: 'OTHERINCOME',
  directcosts: 'DIRECTCOSTS',
  depreciatn: 'DEPRECIATN'
};

/**
 * Sync Xero: list existing accounts, for each template row match by title (Name); if not found create, then save mapping.
 * Case 1: Xero has no accounts → create all from our table. Case 2: Xero has some → map by same name, create missing.
 */
async function syncXeroAccounts(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };

  const [planRows] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
    [clientId, 'plan']
  );
  const planId = planRows[0]?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) {
    return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };
  }

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND provider = 'xero' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!intRows.length) return { ok: false, reason: 'NOT_XERO_PROVIDER' };

  const req = { client: { id: clientId } };
  try {
    const listRes = await xeroAccountWrapper.list(req, {});
    if (!listRes.ok) {
      const errText = (() => {
        const e = listRes.error;
        if (e == null) return '';
        if (typeof e === 'string') return e;
        if (typeof e === 'object') {
          return String(
            e.Detail ||
            e.detail ||
            e.Message ||
            e.message ||
            e.Title ||
            e.title ||
            JSON.stringify(e)
          );
        }
        return String(e);
      })();
      const normErr = errText.toLowerCase();
      const needSettingsScope =
        listRes.status === 401 ||
        listRes.status === 403 ||
        normErr.includes('insufficient_scope') ||
        normErr.includes('scope') ||
        normErr.includes('not authorised');
      if (needSettingsScope) {
        return {
          ok: false,
          reason: 'XERO_SCOPE_ACCOUNTING_SETTINGS_REQUIRED',
          message: 'Xero token missing accounting.settings scope. Please disconnect and reconnect Xero, then sync again.'
        };
      }
      return { ok: false, reason: 'XERO_LIST_ACCOUNTS_FAILED', message: errText || 'Failed to list Xero accounts' };
    }
    const xeroAccounts = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
    const itemListRes = await xeroItemWrapper.list(req, {});
    const xeroItems = itemListRes.ok && Array.isArray(itemListRes.data?.Items) ? itemListRes.data.Items : [];
    if (!itemListRes.ok) {
      const itemErr = typeof itemListRes.error === 'string'
        ? itemListRes.error
        : JSON.stringify(itemListRes.error || {});
      console.warn('[account] syncXeroAccounts list items failed', itemErr);
    }

    const [accountRows] = await pool.query(
      'SELECT id, title, type, is_product, uses_platform_collection_gl FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;
    let createdProducts = 0;
    let linkedProducts = 0;
    let saveMappingFailed = 0;
    const warnings = [];
    function warn(msg) {
      if (warnings.length < 30) warnings.push(msg);
    }
    let codeSeed = Date.now() % 100000;

    let operatorCurrency = 'MYR';
    try {
      const [curRows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
      if (curRows[0]?.currency && String(curRows[0].currency).trim()) {
        operatorCurrency = String(curRows[0].currency).trim().toUpperCase();
      }
    } catch (e) {
      /* keep default */
    }

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const usePlatformGl = row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true;
      const isProd = row.is_product === 1 || row.is_product === true;

      const bukkuType = String(row.type || '').trim().toLowerCase().replace(/-/g, '_');
      let mappedAccountId = null;
      if (!usePlatformGl || !isProd) {
        if (!bukkuType) continue;

        const tNorm = normalize(title);
        let existing = null;

        if (bukkuType === 'current_assets' && tNorm === 'bank') {
          const activeBanks = xeroAccounts.filter(
            (a) =>
              String(a.Status || '').toUpperCase() === 'ACTIVE' && String(a.Type || '').toUpperCase() === 'BANK'
          );
          existing =
            activeBanks.find((a) => normalize(a.Name) === normalize(title)) ||
            (activeBanks.length ? activeBanks[0] : null);
          if (existing) {
            linkedAccounts++;
            if (activeBanks.length > 1 && normalize(existing.Name) !== normalize(title)) {
              warn(
                `Bank template linked to first active Xero BANK account "${existing.Name}" (${existing.Code || existing.AccountID || ''}) — edit mapping if wrong.`
              );
            }
          } else {
            const createRes = await xeroAccountWrapper.create(req, {
              name: title,
              type: 'BANK',
              code: String(++codeSeed).padStart(4, '0'),
              currencyCode: operatorCurrency
            });
            if (!createRes.ok) {
              const createErr = (() => {
                const e = createRes.error;
                if (e == null) return '';
                if (typeof e === 'string') return e;
                if (typeof e === 'object') {
                  return String(
                    e.Detail ||
                      e.detail ||
                      e.Message ||
                      e.message ||
                      e.Title ||
                      e.title ||
                      JSON.stringify(e)
                  );
                }
                return String(e);
              })();
              warn(`Xero create BANK account "${title}" failed: ${createErr || 'unknown error'}`);
              continue;
            }
            const created = createRes.data?.Accounts?.[0];
            if (created) {
              existing = created;
              xeroAccounts.push(existing);
              createdAccounts++;
            } else {
              warn(`Xero create BANK "${title}" returned no Accounts[0]`);
              continue;
            }
          }
        } else {
          let xeroType = BUKKU_TO_XERO_TYPE[bukkuType] || 'EXPENSE';
          if (bukkuType === 'current_assets') {
            if (tNorm === 'cash') xeroType = 'CURRENT';
            else xeroType = 'CURRENT';
          }

          existing = xeroAccounts.find((a) => normalize(a.Name) === normalize(title));
          if (!existing) {
            const createRes = await xeroAccountWrapper.create(req, {
              name: title,
              type: xeroType,
              code: String(++codeSeed).padStart(4, '0')
            });
            if (!createRes.ok) {
              const createErr = (() => {
                const e = createRes.error;
                if (e == null) return '';
                if (typeof e === 'string') return e;
                if (typeof e === 'object') {
                  return String(
                    e.Detail ||
                      e.detail ||
                      e.Message ||
                      e.message ||
                      e.Title ||
                      e.title ||
                      JSON.stringify(e)
                  );
                }
                return String(e);
              })();
              warn(`Xero create account "${title}" failed (${xeroType}): ${createErr || 'unknown error'}`);
              continue;
            }
            const created = createRes.data?.Accounts?.[0];
            if (created) {
              existing = created;
              xeroAccounts.push(existing);
              createdAccounts++;
            } else {
              warn(`Xero create account "${title}" returned no Accounts[0]`);
              continue;
            }
          } else {
            linkedAccounts++;
          }
        }

        const accountId = existing.Code || existing.code || existing.AccountID || existing.accountID;
        if (!accountId) {
          warn(`Xero account "${title}" has no Code/AccountID`);
          continue;
        }
        mappedAccountId = String(accountId);
      }

      let mappedProductId = null;
      if (isProd) {
        let existingItem = xeroItems.find((i) => normalize(i.Name) === normalize(title));
        if (!existingItem) {
          const itemCode = `ITM${String(++codeSeed).padStart(6, '0')}`;
          const createItemRes = await xeroItemWrapper.create(req, {
            code: itemCode,
            name: title
          });
          if (!createItemRes.ok) {
            const itemErr = (() => {
              const e = createItemRes.error;
              if (e == null) return '';
              if (typeof e === 'string') return e;
              if (typeof e === 'object') {
                return String(
                  e.Detail ||
                  e.detail ||
                  e.Message ||
                  e.message ||
                  e.Title ||
                  e.title ||
                  JSON.stringify(e)
                );
              }
              return String(e);
            })();
            warn(`Xero create item "${title}" failed: ${itemErr || 'unknown error'}`);
          } else {
            const createdItem = createItemRes.data?.Items?.[0];
            if (createdItem) {
              existingItem = createdItem;
              xeroItems.push(createdItem);
              createdProducts++;
            }
          }
        } else {
          linkedProducts++;
        }
        const itemCode = existingItem?.Code;
        if (itemCode) mappedProductId = String(itemCode);
      }

      const saveRes = await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'xero',
        accountId: mappedAccountId,
        productId: mappedProductId
      });
      if (!saveRes?.ok) {
        saveMappingFailed += 1;
        warn(`Save mapping "${title}" failed: ${saveRes?.reason || 'unknown'}`);
      }
    }

    return {
      ok: true,
      provider: 'xero',
      createdAccounts,
      linkedAccounts,
      createdProducts,
      linkedProducts,
      saveMappingFailed,
      warnings: warnings.length ? warnings : undefined
    };
  } catch (err) {
    console.error('[account] syncXeroAccounts', err);
    return { ok: false, reason: 'SYNC_XERO_FAILED', message: err.message };
  }
}

async function getClnOperatorCurrency(operatorId) {
  try {
    const t = await resolveClnOperatordetailTable();
    const [[cntRow]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'currency'`,
      [t]
    );
    if (!Number(cntRow?.c)) return 'MYR';
    const [rows] = await pool.query(`SELECT currency FROM \`${t}\` WHERE id = ? LIMIT 1`, [
      String(operatorId)
    ]);
    const c = rows[0]?.currency;
    if (c != null && String(c).trim()) return String(c).trim().toUpperCase();
  } catch (e) {
    console.warn('[account] getClnOperatorCurrency', e?.message || e);
  }
  return 'MYR';
}

async function resolveClnOperatorAccounting(operatorId) {
  const op = String(operatorId);
  const [rows] = await pool.query(
    `SELECT provider, enabled, values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND enabled = 1`,
    [op]
  );
  const bukkuRow = rows.find((r) => String(r.provider || '').toLowerCase() === 'bukku');
  const xeroRow = rows.find((r) => String(r.provider || '').toLowerCase() === 'xero');
  if (bukkuRow) {
    const v = parseJson(bukkuRow.values_json) || {};
    const token = v.bukku_secretKey || v.bukku_token;
    const subdomain = v.bukku_subdomain;
    if (token && subdomain) {
      return {
        ok: true,
        provider: 'bukku',
        req: {
          client: {
            bukku_secretKey: String(token).trim(),
            bukku_subdomain: String(subdomain).trim()
          }
        }
      };
    }
  }
  if (xeroRow) {
    const v = parseJson(xeroRow.values_json) || {};
    if (v.xero_access_token && v.xero_tenant_id) {
      return { ok: true, provider: 'xero', operatorId: op };
    }
  }
  return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
}

async function upsertClnAccountClientMapping(operatorId, accountRowId, externalAccount, externalProduct, system, isProductRow) {
  let extAcc = externalAccount != null ? String(externalAccount).trim() : '';
  const extProd =
    externalProduct != null && String(externalProduct).trim() !== '' ? String(externalProduct).trim() : null;
  if (isProductRow) extAcc = '';
  await pool.query(
    `INSERT INTO cln_account_client (id, operator_id, account_id, external_account, external_product, \`system\`, mapped)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
      external_account = VALUES(external_account),
      external_product = VALUES(external_product),
      mapped = 1,
      updated_at = CURRENT_TIMESTAMP(3)`,
    [crypto.randomUUID(), String(operatorId), accountRowId, extAcc, extProd, system]
  );
}

/**
 * Cleanlemons portal: sync cln_account chart to Bukku (create/link accounts & products, write cln_account_client).
 * Service products link to Sales Income GL; only product id stored on product rows.
 */
async function syncClnBukkuOperatorAccounts(operatorId) {
  const resolved = await resolveClnOperatorAccounting(operatorId);
  if (!resolved.ok) return resolved;
  if (resolved.provider !== 'bukku') return { ok: false, reason: 'NOT_BUKKU_PROVIDER' };
  const req = resolved.req;
  const companyCurrency = await getClnOperatorCurrency(operatorId);

  let bukkuAccounts;
  let bukkuProducts;
  try {
    [bukkuAccounts, bukkuProducts] = await Promise.all([
      fetchAllBukkuAccountsFlat(req),
      fetchAllBukkuProductsFlat(req)
    ]);
    bukkuAccounts = await augmentBukkuAccountsIfMissingBankCashDefaults(req, bukkuAccounts);
  } catch (err) {
    console.error('[account] syncClnBukkuOperatorAccounts fetch', err);
    return { ok: false, reason: 'SYNC_BUKKU_FETCH_FAILED', message: err.message };
  }

  const [accountRows] = await pool.query(
    'SELECT id, title, type, is_product FROM cln_account ORDER BY sort_order ASC, title ASC'
  );

  let salesIncomeAccount = findExistingBukkuAccount(bukkuAccounts, 'Sales Income', 'income');
  if (!salesIncomeAccount) {
    const pcr = await accountWrapper.create(
      req,
      buildBukkuAccountCreatePayload('Sales Income', 'income', companyCurrency)
    );
    if (pcr.ok) {
      salesIncomeAccount = pcr.data?.account || pcr.data;
      if (salesIncomeAccount) bukkuAccounts.push(salesIncomeAccount);
    }
  }
  const salesIncomeRemoteId = salesIncomeAccount ? bukkuRemoteId(salesIncomeAccount) : null;

  let createdAccounts = 0;
  let linkedAccounts = 0;
  let createdProducts = 0;
  let linkedProducts = 0;
  let saveMappingFailed = 0;
  const warnings = [];
  function warn(msg) {
    if (warnings.length < 30) warnings.push(msg);
  }

  for (const row of accountRows) {
    const title = String(row.title || '').trim();
    if (!title) continue;
    const isProd = row.is_product === 1 || row.is_product === true;
    const bukkuType = String(row.type || '').trim();

    if (isProd) {
      if (salesIncomeRemoteId == null) {
        warn(`Product "${title}": skipped — Sales Income account missing in Bukku`);
        saveMappingFailed += 1;
        continue;
      }
      let existingProduct = findExistingBukkuProduct(bukkuProducts, title);
      if (!existingProduct) {
        const createProductRes = await productWrapper.create(
          req,
          buildBukkuProductCreateBody(title, salesIncomeRemoteId)
        );
        if (createProductRes.ok) {
          existingProduct = createProductRes.data?.product || createProductRes.data;
          if (existingProduct) {
            bukkuProducts.push(existingProduct);
            createdProducts++;
          }
        } else {
          warn(
            `Product "${title}": create failed — ${JSON.stringify(createProductRes.error || createProductRes).slice(0, 280)}`
          );
          saveMappingFailed += 1;
          continue;
        }
      } else {
        linkedProducts++;
      }
      const productId = existingProduct ? String(existingProduct.id) : null;
      if (productId) {
        try {
          await upsertClnAccountClientMapping(operatorId, row.id, '', productId, 'bukku', true);
        } catch (e) {
          saveMappingFailed += 1;
          warn(`Product "${title}": save failed — ${e.message}`);
        }
      }
      continue;
    }

    if (!bukkuType) continue;

    const bukkuTypeNormalized = mapDbAccountTypeToBukkuApi(bukkuType);

    let existingAccount = findExistingBukkuAccount(bukkuAccounts, title, bukkuTypeNormalized);
    if (!existingAccount) {
      const byName = findBukkuAccountByExactNameAnyType(bukkuAccounts, title);
      if (byName) {
        existingAccount = byName;
        warn(
          `Account "${title}": linked existing Bukku account by name (GL type in Bukku may differ from template type "${bukkuType}").`
        );
      }
    }
    if (!existingAccount) {
      if (normalize(title) === 'cash' && bukkuTypeNormalized === 'current_assets') {
        warn(
          'Account "Cash": no "Cash on Hand" in Bukku list — skipped POST (do not create a duplicate "Cash" GL).'
        );
        continue;
      }
      if (normalize(title) === 'bank' && bukkuTypeNormalized === 'current_assets') {
        warn(
          'Account "Bank": no "Bank Account" in Bukku list — skipped POST (map template to Bukku default "Bank Account" only).'
        );
        continue;
      }
      const createRes = await accountWrapper.create(
        req,
        buildBukkuAccountCreatePayload(title, bukkuType, companyCurrency)
      );
      if (!createRes.ok) {
        warn(
          `Account "${title}": create failed — ${JSON.stringify(createRes.error || createRes).slice(0, 280)}`
        );
        continue;
      }
      existingAccount = createRes.data?.account || createRes.data;
      if (existingAccount) {
        bukkuAccounts.push(existingAccount);
        createdAccounts++;
      }
    } else {
      linkedAccounts++;
    }
    if (!existingAccount) continue;

    const accountIdStr = String(bukkuRemoteId(existingAccount));
    try {
      await upsertClnAccountClientMapping(operatorId, row.id, accountIdStr, null, 'bukku', false);
    } catch (e) {
      saveMappingFailed += 1;
      warn(`Account "${title}": save failed — ${e.message}`);
    }
  }

  return {
    ok: true,
    provider: 'bukku',
    createdAccounts,
    linkedAccounts,
    createdProducts,
    linkedProducts,
    saveMappingFailed,
    warnings: warnings.length ? warnings : undefined,
    syncedAt: new Date().toISOString()
  };
}

/**
 * Cleanlemons portal: sync cln_account chart to Xero (items for product lines use item code only; GL from Sales Income row for display elsewhere).
 */
async function syncClnXeroOperatorAccounts(operatorId) {
  const resolved = await resolveClnOperatorAccounting(operatorId);
  if (!resolved.ok) return resolved;
  if (resolved.provider !== 'xero') return { ok: false, reason: 'NOT_XERO_PROVIDER' };

  let accessToken;
  let tenantId;
  try {
    const t = await getValidXeroTokenForCleanlemonOperator(operatorId);
    accessToken = t.accessToken;
    tenantId = t.tenantId;
  } catch (err) {
    const msg = err?.message || String(err);
    if (String(msg).includes('XERO_NOT_CONFIGURED')) {
      return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };
    }
    return { ok: false, reason: 'XERO_TOKEN_FAILED', message: msg };
  }

  const listRes = await xerorequest({ method: 'get', endpoint: '/Accounts', accessToken, tenantId });
  if (!listRes.ok) {
    const errText = JSON.stringify(listRes.error || listRes);
    return { ok: false, reason: 'XERO_LIST_ACCOUNTS_FAILED', message: errText.slice(0, 500) };
  }
  const xeroAccounts = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const itemListRes = await xerorequest({ method: 'get', endpoint: '/Items', accessToken, tenantId });
  const xeroItems = itemListRes.ok && Array.isArray(itemListRes.data?.Items) ? itemListRes.data.Items : [];
  if (!itemListRes.ok) {
    console.warn('[account] syncClnXeroOperatorAccounts list items', itemListRes.error);
  }

  const [accountRows] = await pool.query(
    'SELECT id, title, type, is_product FROM cln_account ORDER BY sort_order ASC, title ASC'
  );
  let createdAccounts = 0;
  let linkedAccounts = 0;
  let createdProducts = 0;
  let linkedProducts = 0;
  let saveMappingFailed = 0;
  const warnings = [];
  function warn(msg) {
    if (warnings.length < 30) warnings.push(msg);
  }
  let codeSeed = Date.now() % 100000;
  const clnCurrency = await getClnOperatorCurrency(operatorId);

  for (const row of accountRows) {
    const title = String(row.title || '').trim();
    if (!title) continue;
    const isProd = row.is_product === 1 || row.is_product === true;
    const bukkuType = String(row.type || '').trim().toLowerCase().replace(/-/g, '_');

    if (isProd) {
      let existingItem = xeroItems.find((i) => normalize(i.Name) === normalize(title));
      if (!existingItem) {
        const itemCode = `ITM${String(++codeSeed).padStart(6, '0')}`;
        const createItemRes = await xerorequest({
          method: 'put',
          endpoint: '/Items',
          accessToken,
          tenantId,
          data: {
            Items: [{ Code: itemCode.slice(0, 30), Name: title.slice(0, 4000) }]
          }
        });
        if (!createItemRes.ok) {
          warn(`Xero create item "${title}" failed: ${JSON.stringify(createItemRes.error || '').slice(0, 200)}`);
          saveMappingFailed += 1;
          continue;
        }
        const createdItem = createItemRes.data?.Items?.[0];
        if (createdItem) {
          existingItem = createdItem;
          xeroItems.push(createdItem);
          createdProducts++;
        }
      } else {
        linkedProducts++;
      }
      const itemCode = existingItem?.Code;
      if (itemCode) {
        try {
          await upsertClnAccountClientMapping(operatorId, row.id, '', String(itemCode), 'xero', true);
        } catch (e) {
          saveMappingFailed += 1;
          warn(`Save product "${title}": ${e.message}`);
        }
      }
      continue;
    }

    if (!bukkuType) continue;

    const tNorm = normalize(title);
    let existing = null;

    if (bukkuType === 'current_assets' && tNorm === 'bank') {
      const activeBanks = xeroAccounts.filter(
        (a) =>
          String(a.Status || '').toUpperCase() === 'ACTIVE' && String(a.Type || '').toUpperCase() === 'BANK'
      );
      existing =
        activeBanks.find((a) => normalize(a.Name) === normalize(title)) ||
        (activeBanks.length ? activeBanks[0] : null);
      if (existing) {
        linkedAccounts++;
        if (activeBanks.length > 1 && normalize(existing.Name) !== normalize(title)) {
          warn(
            `Bank template linked to first active Xero BANK account "${existing.Name}" (${existing.Code || existing.AccountID || ''}) — edit mapping if wrong.`
          );
        }
      } else {
        const createRes = await xerorequest({
          method: 'put',
          endpoint: '/Accounts',
          accessToken,
          tenantId,
          data: {
            Accounts: [
              {
                Name: title,
                Type: 'BANK',
                Code: String(++codeSeed).padStart(4, '0'),
                CurrencyCode: clnCurrency
              }
            ]
          }
        });
        if (!createRes.ok) {
          warn(`Xero create BANK "${title}" failed: ${JSON.stringify(createRes.error || '').slice(0, 200)}`);
          continue;
        }
        const created = createRes.data?.Accounts?.[0];
        if (created) {
          existing = created;
          xeroAccounts.push(existing);
          createdAccounts++;
        } else {
          continue;
        }
      }
    } else {
      let xeroType = BUKKU_TO_XERO_TYPE[bukkuType] || 'EXPENSE';
      if (bukkuType === 'current_assets') {
        if (tNorm === 'cash') xeroType = 'CURRENT';
        else xeroType = 'CURRENT';
      }

      existing = xeroAccounts.find((a) => normalize(a.Name) === normalize(title));
      if (!existing) {
        const createRes = await xerorequest({
          method: 'put',
          endpoint: '/Accounts',
          accessToken,
          tenantId,
          data: {
            Accounts: [
              {
                Name: title,
                Type: xeroType,
                Code: String(++codeSeed).padStart(4, '0')
              }
            ]
          }
        });
        if (!createRes.ok) {
          warn(`Xero create account "${title}" failed: ${JSON.stringify(createRes.error || '').slice(0, 200)}`);
          continue;
        }
        const created = createRes.data?.Accounts?.[0];
        if (created) {
          existing = created;
          xeroAccounts.push(existing);
          createdAccounts++;
        } else {
          continue;
        }
      } else {
        linkedAccounts++;
      }
    }

    const accountId = existing.Code || existing.code || existing.AccountID || existing.accountID;
    if (!accountId) {
      warn(`Xero account "${title}" has no Code/AccountID`);
      continue;
    }
    try {
      await upsertClnAccountClientMapping(operatorId, row.id, String(accountId), null, 'xero', false);
    } catch (e) {
      saveMappingFailed += 1;
      warn(`Save "${title}": ${e.message}`);
    }
  }

  return {
    ok: true,
    provider: 'xero',
    createdAccounts,
    linkedAccounts,
    createdProducts,
    linkedProducts,
    saveMappingFailed,
    warnings: warnings.length ? warnings : undefined,
    syncedAt: new Date().toISOString()
  };
}

/**
 * Cleanlemons operator accounting sync — same idea as syncAccounts (Bukku/Xero): match by name, create when missing, persist cln_account_client.
 */
async function syncClnOperatorAccountingMappings(operatorId) {
  if (!operatorId || typeof operatorId !== 'string') {
    return { ok: false, reason: 'NO_OPERATOR_ID' };
  }
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_integration (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      \`key\` VARCHAR(64) NOT NULL,
      version INT NOT NULL DEFAULT 1,
      slot INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      provider VARCHAR(64) NOT NULL,
      values_json LONGTEXT NOT NULL,
      einvoice TINYINT(1) NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_cln_operator_integration (operator_id, \`key\`, provider)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ).catch(() => {});

  const resolved = await resolveClnOperatorAccounting(operatorId);
  if (!resolved.ok) return resolved;
  if (resolved.provider === 'bukku') return syncClnBukkuOperatorAccounts(operatorId);
  if (resolved.provider === 'xero') return syncClnXeroOperatorAccounts(operatorId);
  return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
}

/**
 * Sync AutoCount: list existing accounts (and products); for each template row find by title or create, then save mapping.
 * Flow: 先查有没有户口 → 没有才 create.
 */
async function syncAutoCountAccounts(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };

  const [planRows] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
    [clientId, 'plan']
  );
  const planId = planRows[0]?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) {
    return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };
  }

  const [intRows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'autocount' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!intRows.length) return { ok: false, reason: 'NOT_AUTOCOUNT_PROVIDER' };

  const req = { client: { id: clientId } };
  try {
    const listRes = await autocountAccountWrapper.listAccounts(req, {});
    if (!listRes.ok) return { ok: false, reason: 'AUTOCOUNT_LIST_ACCOUNTS_FAILED', message: listRes.error };
    const rawData = listRes.data || {};
    const autoCountAccounts = Array.isArray(rawData.accounts)
      ? rawData.accounts
      : Array.isArray(rawData.account)
        ? rawData.account
        : Array.isArray(rawData) ? rawData : [];

    let productList = [];
    try {
      const productRes = await autocountProductWrapper.listProducts(req, {});
      if (productRes.ok && productRes.data) {
        const pd = productRes.data;
        productList = Array.isArray(pd.products) ? pd.products : Array.isArray(pd.product) ? pd.product : Array.isArray(pd) ? pd : [];
      }
    } catch (_) { /* product list optional */ }

    const [accountRows] = await pool.query(
      'SELECT id, title, type, is_product, uses_platform_collection_gl FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;
    let createdProducts = 0;
    let linkedProducts = 0;

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const usePlatformGl = row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true;
      const isProd = row.is_product === 1 || row.is_product === true;
      const bukkuType = String(row.type || '').trim();

      if (usePlatformGl && isProd) {
        let productId = null;
        let existingProduct = productList.find((p) => normalize((p.name || p.Name || '').toString()) === normalize(title));
        if (!existingProduct) {
          try {
            const createProductRes = await autocountProductWrapper.createProduct(req, {
              name: title,
              isSelling: true,
              isBuying: false
            });
            if (createProductRes.ok) {
              const created = createProductRes.data?.product ?? createProductRes.data?.Product ?? createProductRes.data;
              if (created) {
                existingProduct = created;
                productList.push(existingProduct);
                createdProducts++;
              }
            }
          } catch (_) { /* skip */ }
        } else {
          linkedProducts++;
        }
        if (existingProduct) {
          const pid = existingProduct.id ?? existingProduct.Id ?? existingProduct.code ?? existingProduct.Code;
          if (pid != null) productId = String(pid);
        }
        if (productId) {
          await saveBukkuAccount(email, {
            item: { _id: row.id },
            clientId,
            system: 'autocount',
            accountId: null,
            productId
          });
        }
        continue;
      }

      if (!bukkuType) continue;

      let existingAccount = autoCountAccounts.find(
        (a) => normalize((a.name || a.Name || a.description || '').toString()) === normalize(title)
      );
      if (!existingAccount) {
        const createRes = await autocountAccountWrapper.createAccount(req, {
          name: title,
          type: bukkuType || 'EXPENSE',
          classification: 'OPERATING'
        });
        if (!createRes.ok) continue;
        const created = createRes.data?.account ?? createRes.data?.Account ?? createRes.data;
        if (created) {
          existingAccount = created;
          autoCountAccounts.push(existingAccount);
          createdAccounts++;
        } else continue;
      } else {
        linkedAccounts++;
      }

      let productId = null;
      if (row.is_product === 1 || row.is_product === true) {
        let existingProduct = productList.find((p) => normalize((p.name || p.Name || '').toString()) === normalize(title));
        if (!existingProduct) {
          try {
            const createProductRes = await autocountProductWrapper.createProduct(req, {
              name: title,
              isSelling: true,
              isBuying: false
            });
            if (createProductRes.ok) {
              const created = createProductRes.data?.product ?? createProductRes.data?.Product ?? createProductRes.data;
              if (created) {
                existingProduct = created;
                productList.push(existingProduct);
                createdProducts++;
              }
            }
          } catch (_) { /* skip */ }
        } else {
          linkedProducts++;
        }
        if (existingProduct) {
          const pid = existingProduct.id ?? existingProduct.Id ?? existingProduct.code ?? existingProduct.Code;
          if (pid != null) productId = String(pid);
        }
      }

      const accountId = existingAccount.id ?? existingAccount.Id ?? existingAccount.code ?? existingAccount.Code;
      if (!accountId) continue;
      await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'autocount',
        accountId: String(accountId),
        productId
      });
    }

    return {
      ok: true,
      provider: 'autocount',
      createdAccounts,
      linkedAccounts,
      createdProducts,
      linkedProducts
    };
  } catch (err) {
    console.error('[account] syncAutoCountAccounts', err);
    return { ok: false, reason: 'SYNC_AUTOCOUNT_FAILED', message: err.message };
  }
}

/**
 * Sync SQL Account: list existing accounts; for each template row find by title or create, then save mapping.
 * Flow: 先查有没有户口 → 没有才 create. Paths per https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */
async function syncSqlAccounts(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };

  const [planRows] = await pool.query(
    'SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = ? LIMIT 1',
    [clientId, 'plan']
  );
  const planId = planRows[0]?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) {
    return { ok: false, reason: 'NO_ACCOUNTING_CAPABILITY' };
  }

  const [intRows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'sql' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!intRows.length) return { ok: false, reason: 'NOT_SQL_PROVIDER' };

  const req = { client: { id: clientId } };
  try {
    console.log('[account][sql-sync] start', { clientId, email });
    const listRes = await sqlaccountAccountWrapper.listAccounts(req, {});
    if (!listRes.ok) {
      console.warn('[account][sql-sync] listAccounts failed', { clientId, error: listRes.error || listRes.message });
      return { ok: false, reason: 'SQL_LIST_ACCOUNTS_FAILED', message: listRes.error || listRes.message };
    }
    const rawData = listRes.data || {};
    const sqlAccounts = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData.data) ? rawData.data : Array.isArray(rawData.accounts) ? rawData.accounts : Array.isArray(rawData.Account) ? rawData.Account : [];

    const toSqlAcctType = (localType) => {
      const t = String(localType || '').trim().toLowerCase();
      if (!t) return 'CA';
      if (t === 'income' || t === 'other_income' || t === 'revenue') return 'IN';
      if (t === 'cost_of_sales') return 'CS';
      if (t === 'current_assets' || t === 'non_current_assets' || t === 'other_assets') return 'CA';
      if (t === 'current_liabilities' || t === 'non_current_liabilities' || t === 'liability') return 'CL';
      if (t === 'equity') return 'EQ';
      if (t === 'expense' || t === 'expenses' || t === 'taxation') return 'EX';
      return 'CA';
    };
    const buildSqlCode = (title, fallbackId) => {
      const base = String(title || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 12);
      const suffix = String(fallbackId || '').replace(/-/g, '').slice(0, 6).toUpperCase();
      return (base || 'ACC') + (suffix ? `-${suffix}` : '');
    };
    const buildSqlCodeCandidates = (title, fallbackId) => {
      const raw = String(title || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const withSuffix = buildSqlCode(title, fallbackId);
      const base12 = raw.slice(0, 12);
      const base10 = raw.slice(0, 10);
      const base9 = raw.slice(0, 9);
      return [...new Set([withSuffix, base12, base10, base9].filter(Boolean))];
    };
    const extractDuplicateCodeFromMessage = (msg) => {
      const s = String(msg || '');
      // Match both raw and JSON-escaped variants:
      // ("CODE" = 'BANK-1C7E4')  or  (\"CODE\" = 'BANK-1C7E4')
      const m = s.match(/(?:\\?"CODE\\?"|CODE)\s*=\s*'([^']+)'/i);
      return String(m?.[1] || '').trim();
    };
    const readSqlAccountByCode = async (code) => {
      const c = String(code || '').trim();
      if (!c) return null;
      const readRes = await sqlaccountAccountWrapper.read(req, c);
      if (!readRes?.ok) return null;
      const d = readRes.data;
      return (
        (Array.isArray(d?.data) && d.data[0]) ||
        (d?.data && typeof d.data === 'object' ? d.data : null) ||
        (d && typeof d === 'object' ? d : null)
      );
    };
    const findByAnyCode = (list, codes) => {
      const set = new Set((codes || []).map((c) => normalize(c)));
      return (list || []).find((a) => set.has(normalize((a.code || a.Code || '').toString())));
    };

    const [accountRows] = await pool.query(
      'SELECT id, title, type, is_product, uses_platform_collection_gl FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;
    const warnings = [];

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const usePlatformGl = row.uses_platform_collection_gl === 1 || row.uses_platform_collection_gl === true;
      const isProd = row.is_product === 1 || row.is_product === true;
      if (usePlatformGl && isProd) continue;

      const rowType = String(row.type || '').trim();
      if (!rowType) continue;
      const expectedCode = buildSqlCode(title, row.id);
      const codeCandidates = buildSqlCodeCandidates(title, row.id);

      let existingAccount = sqlAccounts.find(
        (a) => normalize((a.name || a.Name || a.description || a.AccountName || '').toString()) === normalize(title)
      );
      if (!existingAccount) {
        existingAccount = findByAnyCode(sqlAccounts, codeCandidates);
      }
      if (!existingAccount) {
        for (const c of codeCandidates) {
          const one = await readSqlAccountByCode(c);
          if (one) {
            existingAccount = one;
            sqlAccounts.push(one);
            break;
          }
        }
      }
      if (!existingAccount) {
        const sqlType = toSqlAcctType(rowType);
        const createRes = await sqlaccountAccountWrapper.createAccount(req, {
          dockey: 0,
          parent: 1,
          code: expectedCode,
          description: title,
          description2: '',
          acctype: sqlType,
          specialacctype: '',
          tax: '',
          cashflowtype: 0,
          sic: ''
        });
        if (!createRes.ok) {
          const msg = JSON.stringify(createRes.error || createRes.message || createRes);
          if (/duplicate value|unique index|gl_acc_code|code/i.test(msg)) {
            // First try to extract SQL's actual conflicting code from error message.
            const duplicateCode = extractDuplicateCodeFromMessage(msg);
            if (duplicateCode) {
              console.log('[account][sql-sync] duplicate code detected', { title, expectedCode, duplicateCode });
            }
            if (duplicateCode) {
              const one = await readSqlAccountByCode(duplicateCode);
              if (one) {
                existingAccount = one;
                sqlAccounts.push(one);
              }
            }
          }
          if (!existingAccount && /duplicate value|unique index|gl_acc_code|code/i.test(msg)) {
            for (const c of codeCandidates) {
              const one = await readSqlAccountByCode(c);
              if (one) {
                existingAccount = one;
                sqlAccounts.push(one);
                break;
              }
            }
          }
          if (!existingAccount) {
            warnings.push(`Create "${title}" failed: ${msg.slice(0, 220)}`);
            continue;
          }
        }
        if (!existingAccount) {
          const created = createRes.data?.account ?? createRes.data?.Account ?? createRes.data;
          if (created) {
            existingAccount = created;
            sqlAccounts.push(existingAccount);
            createdAccounts++;
          } else continue;
        }
      } else {
        linkedAccounts++;
      }

      const accountId = existingAccount.id ?? existingAccount.Id ?? existingAccount.code ?? existingAccount.Code ?? existingAccount.AccountID ?? existingAccount.dockey;
      if (!accountId) continue;
      await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'sql',
        accountId: String(accountId),
        productId: null
      });
    }

    // SaaS enhancement: auto-fill SQL payment method codes from /pmmethod (official API).
    const valuesRaw = intRows[0]?.values_json;
    const currentValues = parseJson(valuesRaw) || {};
    const pmRes = await sqlaccountPaymentMethodWrapper.list(req, { limit: 500 });
    const pmPayload = pmRes?.ok ? (pmRes.data || {}) : {};
    const sqlPaymentMethods = Array.isArray(pmPayload)
      ? pmPayload
      : (Array.isArray(pmPayload.data) ? pmPayload.data : []);
    const pmPreview = (sqlPaymentMethods || []).slice(0, 8).map((x) => ({
      code: String(x?.code || x?.Code || '').trim(),
      description: String(x?.description || x?.Description || x?.name || x?.Name || '').trim()
    }));
    if (!pmRes?.ok) {
      console.warn('[account][sql-sync] /pmmethod failed', { clientId, error: pmRes?.error || pmRes?.message });
    } else {
      console.log('[account][sql-sync] /pmmethod loaded', {
        clientId,
        count: sqlPaymentMethods.length,
        preview: pmPreview
      });
    }
    const findSqlPaymentMethodCode = (keywords = []) => {
      const words = keywords.map(normalizeToken).filter(Boolean);
      if (!words.length) return '';
      const rows = Array.isArray(sqlPaymentMethods) ? sqlPaymentMethods : [];
      const match = rows.find((a) => {
        const code = normalizeToken(a.code || a.Code);
        const desc = normalizeToken(a.description || a.Description || a.description2 || a.title || a.name || a.Name);
        return words.some((w) => code.includes(w) || desc.includes(w));
      });
      return String(match?.code || match?.Code || '').trim();
    };
    const pmCodes = (sqlPaymentMethods || [])
      .map((x) => String(x?.code || x?.Code || '').trim())
      .filter(Boolean);
    let bankCode = findSqlPaymentMethodCode(['bank', 'current account', 'bank transfer']);
    let cashCode = findSqlPaymentMethodCode(['cash', 'petty cash']);
    // Some SQL setups expose pmmethod codes without descriptive names.
    // Fallback to first available codes so mark-as-paid can proceed.
    if (!bankCode && pmCodes.length) bankCode = pmCodes[0];
    if (!cashCode && pmCodes.length) cashCode = pmCodes[1] || pmCodes[0];
    console.log('[account][sql-sync] pmmethod auto-pick', {
      clientId,
      bankCode: bankCode || null,
      cashCode: cashCode || null
    });
    const nextValues = {
      ...currentValues,
      ...(bankCode
        ? {
            sqlaccount_payment_method_code_bank: bankCode,
            sqlaccount_receipt_account_code_bank: currentValues.sqlaccount_receipt_account_code_bank || ''
          }
        : {}),
      ...(cashCode
        ? {
            sqlaccount_payment_method_code_cash: cashCode,
            sqlaccount_receipt_account_code_cash: currentValues.sqlaccount_receipt_account_code_cash || ''
          }
        : {})
    };
    if (
      normalizeToken(nextValues.sqlaccount_payment_method_code_bank) !== normalizeToken(currentValues.sqlaccount_payment_method_code_bank) ||
      normalizeToken(nextValues.sqlaccount_payment_method_code_cash) !== normalizeToken(currentValues.sqlaccount_payment_method_code_cash) ||
      normalizeToken(nextValues.sqlaccount_receipt_account_code_bank) !== normalizeToken(currentValues.sqlaccount_receipt_account_code_bank) ||
      normalizeToken(nextValues.sqlaccount_receipt_account_code_cash) !== normalizeToken(currentValues.sqlaccount_receipt_account_code_cash)
    ) {
      await pool.query(
        `UPDATE client_integration SET values_json = ?, updated_at = NOW()
         WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'sql' AND enabled = 1`,
        [JSON.stringify(nextValues), clientId]
      );
      console.log('[account][sql-sync] integration values_json updated', {
        clientId,
        sqlaccount_payment_method_code_bank: nextValues.sqlaccount_payment_method_code_bank || null,
        sqlaccount_payment_method_code_cash: nextValues.sqlaccount_payment_method_code_cash || null,
        sqlaccount_receipt_account_code_bank: nextValues.sqlaccount_receipt_account_code_bank || null,
        sqlaccount_receipt_account_code_cash: nextValues.sqlaccount_receipt_account_code_cash || null
      });
    }

    console.log('[account][sql-sync] done', {
      clientId,
      createdAccounts,
      linkedAccounts,
      warnings: warnings.length
    });
    return {
      ok: true,
      provider: 'sql',
      createdAccounts,
      linkedAccounts,
      createdProducts: 0,
      linkedProducts: 0,
      warnings: warnings.length ? warnings : undefined,
      sqlPaymentMethodAutoFill: {
        bank: bankCode || null,
        cash: cashCode || null
      }
    };
  } catch (err) {
    console.error('[account] syncSqlAccounts', err);
    return { ok: false, reason: 'SYNC_SQL_FAILED', message: err.message };
  }
}

/**
 * Sync accounts by visitor's client account system: list remote accounts/products first, match by name
 * (and Bukku: name+type, then name-only), reuse IDs when found; create only when missing; then save mapping.
 */
async function syncAccounts(email) {
  if (!email || typeof email !== 'string' || !String(email).trim()) {
    return { ok: false, reason: 'NO_EMAIL' };
  }
  const ctx = await getAccessContextByEmail(email);
  if (!ctx.ok) return { ok: false, reason: ctx.reason || 'ACCESS_DENIED' };
  if (!ctx.staff?.permission?.integration && !ctx.staff?.permission?.admin && !ctx.staff?.permission?.billing) {
    return { ok: false, reason: 'NO_PERMISSION' };
  }
  const clientId = ctx.client?.id;
  if (!clientId) return { ok: false, reason: 'NO_CLIENT' };

  const [intRows] = await pool.query(
    `SELECT provider FROM client_integration WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  const provider = intRows[0] ? (intRows[0].provider || '').toString().trim().toLowerCase() : '';
  if (!provider) return { ok: false, reason: 'NO_ACCOUNT_INTEGRATION' };

  if (provider === 'bukku') return syncBukkuAccounts(email);
  if (provider === 'xero') return syncXeroAccounts(email);
  if (provider === 'autocount' || provider === 'sql') {
    return { ok: false, reason: 'ACCOUNTING_PROVIDER_REMOVED', provider };
  }
  return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
}

module.exports = {
  resolveAccountSystem,
  listAccountTemplates,
  getAccountById,
  saveBukkuAccount,
  syncBukkuAccounts,
  syncXeroAccounts,
  syncAutoCountAccounts,
  syncSqlAccounts,
  syncAccounts,
  syncClnOperatorAccountingMappings,
  resolveClnOperatorAccounting
};
