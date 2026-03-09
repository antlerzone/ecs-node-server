/**
 * Account (SaaS) – accounting settings page: bukkuid list, per-client mapping, save, sync.
 * Migrated from Wix CMS bukkuid + backend/bukku/saveaccount.jsw + syncaccount.jsw.
 * MySQL: account (id, wix_id, title, type, bukkuaccounttype, account_json), client_integration (addonAccount).
 * Mapping: bukkuid → account table; bukkuid.account[] → account.account_json (array of { clientId, client_id?, system, accountid, productId }).
 * Only writes when visitor's client account system matches (xero/bukku/autocount/sql).
 */

const pool = require('../../config/db');

/** Allowed accounting systems; save only accepts the client's actual provider. */
const ALLOWED_ACCOUNT_PROVIDERS = ['xero', 'bukku', 'autocount', 'sql'];
const { getAccessContextByEmail } = require('../access/access.service');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const accountWrapper = require('../bukku/wrappers/account.wrapper');
const productWrapper = require('../bukku/wrappers/product.wrapper');
const xeroAccountWrapper = require('../xero/wrappers/account.wrapper');
const autocountAccountWrapper = require('../autocount/wrappers/account.wrapper');
const autocountProductWrapper = require('../autocount/wrappers/product.wrapper');
const sqlaccountAccountWrapper = require('../sqlaccount/wrappers/account.wrapper');

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
    'SELECT id, title, currency FROM clientdetail WHERE id = ? LIMIT 1',
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
  } else if (provider === 'autocount' || provider === 'sql') {
    credential = null;
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

const PROTECTED_BUKKUID_IDS = [
  'bf502145-6ec8-45bd-a703-13c810cfe186', '1c7e41b6-9d57-4c03-8122-a76baad3b592',
  'ae94f899-7f34-4aba-b6ee-39b97496e2a3', '18ba3daf-7208-46fc-8e97-43f34e898401',
  '86da59c0-992c-4e40-8efd-9d6d793eaf6a', '94b4e060-3999-4c76-8189-f969615c0a7d',
  'cf4141b1-c24e-4fc1-930e-cfea4329b178', 'e4fd92bb-de15-4ca0-9c6b-05e410815c58',
  'bdf3b91c-d2ca-4e42-8cc7-a5f19f271e00', '620b2d43-4b3a-448f-8a5b-99eb2c3209c7',
  'd3f72d51-c791-4ef0-aeec-3ed1134e5c86', '3411c69c-bfec-4d35-a6b9-27929f9d5bf6',
  'e053b254-5a3c-4b82-8ba0-fd6d0df231d3',
  '26a35506-0631-4d79-9b4f-a8195b69c8ed', 'd553cdbe-bc6b-46c2-aba8-f71aceedaf10'
];

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

  const [rows] = await pool.query(
    `SELECT a.id, a.wix_id, a.title, a.type, a.bukkuaccounttype, a.account_json,
            ac.\`system\` AS ac_system, ac.accountid AS ac_accountid, ac.product_id AS ac_product_id
     FROM account a
     LEFT JOIN account_client ac ON ac.account_id = a.id AND ac.client_id = ?
     ORDER BY a.title ASC`,
    [clientId]
  );

  return rows.map((row) => {
    let myAccount = null;
    if (row.ac_accountid != null && String(row.ac_accountid).trim() !== '') {
      myAccount = {
        clientId: clientId,
        system: row.ac_system || 'bukku',
        accountid: row.ac_accountid,
        productId: row.ac_product_id != null ? String(row.ac_product_id) : ''
      };
    } else {
      const accountArr = parseJson(row.account_json);
      const arr = Array.isArray(accountArr) ? accountArr : [];
      const a = arr.find(
        (x) => x && (x.clientId === clientId || x.client_id === clientId)
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
    const isProtected = PROTECTED_BUKKUID_IDS.includes(row.id) || (row.wix_id && PROTECTED_BUKKUID_IDS.includes(row.wix_id));
    return {
      _id: row.id,
      id: row.id,
      title: row.title,
      type: row.type,
      bukkuaccounttype: row.bukkuaccounttype,
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

  const [rows] = await pool.query(
    `SELECT a.id, a.wix_id, a.title, a.type, a.bukkuaccounttype, a.account_json,
            ac.\`system\` AS ac_system, ac.accountid AS ac_accountid, ac.product_id AS ac_product_id
     FROM account a
     LEFT JOIN account_client ac ON ac.account_id = a.id AND ac.client_id = ?
     WHERE a.id = ? LIMIT 1`,
    [clientId, accountId]
  );
  if (!rows.length) throw new Error('NOT_FOUND');

  const row = rows[0];
  let myAccount = null;
  if (row.ac_accountid != null && String(row.ac_accountid).trim() !== '') {
    myAccount = {
      clientId: clientId,
      system: row.ac_system || 'bukku',
      accountid: row.ac_accountid,
      productId: row.ac_product_id != null ? String(row.ac_product_id) : ''
    };
  } else {
    const accountArr = parseJson(row.account_json);
    const arr = Array.isArray(accountArr) ? accountArr : [];
    const a = arr.find((x) => x && (x.clientId === clientId || x.client_id === clientId));
    if (a) {
      myAccount = {
        clientId: a.clientId || a.client_id,
        system: a.system,
        accountid: a.accountid,
        productId: a.productId
      };
    }
  }
  const isProtected = PROTECTED_BUKKUID_IDS.includes(row.id) || (row.wix_id && PROTECTED_BUKKUID_IDS.includes(row.wix_id));

  return {
    _id: row.id,
    id: row.id,
    title: row.title,
    type: row.type,
    bukkuaccounttype: row.bukkuaccounttype,
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

  if (!accountId || String(accountId).trim() === '') {
    await pool.query(
      'DELETE FROM account_client WHERE account_id = ? AND client_id = ? AND `system` = ?',
      [item._id, resolvedClientId, provider]
    );
    return { ok: true, reason: 'DELETED' };
  }

  const productIdVal = productId != null ? String(productId) : null;
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

  const req = { client: { bukku_secretKey: token, bukku_subdomain: subdomain } };

  try {
    const [bukkuRes, productRes] = await Promise.all([
      accountWrapper.list(req, {}),
      productWrapper.list(req, {})
    ]);
    if (!bukkuRes.ok) return { ok: false, reason: 'BUKKU_LIST_ACCOUNTS_FAILED' };
    const bukkuAccounts = Array.isArray(bukkuRes.data?.accounts) ? bukkuRes.data.accounts : (Array.isArray(bukkuRes.data) ? bukkuRes.data : []);
    const bukkuProducts = Array.isArray(productRes.data?.products) ? productRes.data.products : (Array.isArray(productRes.data) ? productRes.data : []);

    const [accountRows] = await pool.query(
      'SELECT id, wix_id, title, type, bukkuaccounttype, account_json FROM account ORDER BY title ASC'
    );

    let createdAccounts = 0;
    let linkedAccounts = 0;
    let createdProducts = 0;
    let linkedProducts = 0;

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      const bukkuType = String(row.bukkuaccounttype || '').trim();
      if (!title || !bukkuType) continue;

      let existingAccount = bukkuAccounts.find(
        (a) => normalize(a.name) === normalize(title) && normalize(a.type) === normalize(bukkuType)
      );
      if (!existingAccount) {
        const createRes = await accountWrapper.create(req, {
          name: title,
          type: bukkuType,
          classification: 'OPERATING'
        });
        if (!createRes.ok) continue;
        existingAccount = createRes.data?.account || createRes.data;
        if (existingAccount) bukkuAccounts.push(existingAccount);
        createdAccounts++;
      }
      linkedAccounts++;

      let productId = null;
      if (row.type && String(row.type).trim() !== '') {
        let existingProduct = bukkuProducts.find((p) => normalize(p.name) === normalize(title));
        if (!existingProduct) {
          const createProductRes = await productWrapper.create(req, {
            name: title,
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
          });
          if (createProductRes.ok) {
            existingProduct = createProductRes.data?.product || createProductRes.data;
            if (existingProduct) {
              bukkuProducts.push(existingProduct);
              createdProducts++;
            }
          }
        }
        if (existingProduct) {
          productId = String(existingProduct.id);
          linkedProducts++;
        }
      }

      await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'bukku',
        accountId: String(existingAccount.id),
        productId
      });
    }

    return {
      ok: true,
      provider: 'bukku',
      createdAccounts,
      linkedAccounts,
      createdProducts,
      linkedProducts
    };
  } catch (err) {
    console.error('[account] syncBukkuAccounts', err);
    return { ok: false, reason: 'SYNC_BUKKU_FAILED', message: err.message };
  }
}

/** Map bukkuaccounttype (our table) to Xero Account Type */
const BUKKU_TO_XERO_TYPE = {
  revenue: 'REVENUE', revenue_type: 'REVENUE',
  expense: 'EXPENSE', expense_type: 'EXPENSE',
  bank: 'BANK', current_asset: 'CURRENT', current_liability: 'CURRLIAB',
  currliab: 'CURRLIAB', fixed: 'FIXED', liability: 'LIABILITY',
  equity: 'EQUITY', sales: 'SALES', otherincome: 'OTHERINCOME',
  directcosts: 'DIRECTCOSTS', depreciatn: 'DEPRECIATN'
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
    if (!listRes.ok) return { ok: false, reason: 'XERO_LIST_ACCOUNTS_FAILED', message: listRes.error };
    const xeroAccounts = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];

    const [accountRows] = await pool.query(
      'SELECT id, wix_id, title, type, bukkuaccounttype FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;
    let codeSeed = Date.now() % 100000;

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;
      const bukkuType = String(row.bukkuaccounttype || '').trim().toLowerCase().replace(/-/g, '_');
      const xeroType = BUKKU_TO_XERO_TYPE[bukkuType] || 'EXPENSE';

      let existing = xeroAccounts.find((a) => normalize(a.Name) === normalize(title));
      if (!existing) {
        const createRes = await xeroAccountWrapper.create(req, {
          name: title,
          type: xeroType,
          code: String(++codeSeed).padStart(4, '0')
        });
        if (!createRes.ok) continue;
        const created = createRes.data?.Accounts?.[0];
        if (created) {
          existing = created;
          xeroAccounts.push(existing);
          createdAccounts++;
        } else continue;
      }
      linkedAccounts++;
      const accountId = existing.AccountID || existing.accountID;
      if (!accountId) continue;
      await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'xero',
        accountId: String(accountId),
        productId: null
      });
    }

    return {
      ok: true,
      provider: 'xero',
      createdAccounts,
      linkedAccounts,
      createdProducts: 0,
      linkedProducts: 0
    };
  } catch (err) {
    console.error('[account] syncXeroAccounts', err);
    return { ok: false, reason: 'SYNC_XERO_FAILED', message: err.message };
  }
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
      'SELECT id, wix_id, title, type, bukkuaccounttype FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;
    let createdProducts = 0;
    let linkedProducts = 0;

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      const bukkuType = String(row.bukkuaccounttype || '').trim();
      if (!title) continue;

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
      }
      linkedAccounts++;

      let productId = null;
      if (row.type && String(row.type).trim() !== '') {
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
        }
        if (existingProduct) {
          const pid = existingProduct.id ?? existingProduct.Id ?? existingProduct.code ?? existingProduct.Code;
          if (pid != null) productId = String(pid);
          linkedProducts++;
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
    const listRes = await sqlaccountAccountWrapper.listAccounts(req, {});
    if (!listRes.ok) {
      return { ok: false, reason: 'SQL_LIST_ACCOUNTS_FAILED', message: listRes.error || listRes.message };
    }
    const rawData = listRes.data || {};
    const sqlAccounts = Array.isArray(rawData)
      ? rawData
      : Array.isArray(rawData.accounts) ? rawData.accounts : Array.isArray(rawData.Account) ? rawData.Account : Array.isArray(rawData.data) ? rawData.data : [];

    const [accountRows] = await pool.query(
      'SELECT id, wix_id, title, type, bukkuaccounttype FROM account ORDER BY title ASC'
    );
    let createdAccounts = 0;
    let linkedAccounts = 0;

    for (const row of accountRows) {
      const title = String(row.title || '').trim();
      if (!title) continue;

      let existingAccount = sqlAccounts.find(
        (a) => normalize((a.name || a.Name || a.description || a.AccountName || '').toString()) === normalize(title)
      );
      if (!existingAccount) {
        const createRes = await sqlaccountAccountWrapper.createAccount(req, {
          name: title,
          type: String(row.bukkuaccounttype || '').trim() || 'Expense'
        });
        if (!createRes.ok) continue;
        const created = createRes.data?.account ?? createRes.data?.Account ?? createRes.data;
        if (created) {
          existingAccount = created;
          sqlAccounts.push(existingAccount);
          createdAccounts++;
        } else continue;
      }
      linkedAccounts++;

      const accountId = existingAccount.id ?? existingAccount.Id ?? existingAccount.code ?? existingAccount.Code ?? existingAccount.AccountID;
      if (!accountId) continue;
      await saveBukkuAccount(email, {
        item: { _id: row.id },
        clientId,
        system: 'sql',
        accountId: String(accountId),
        productId: null
      });
    }

    return {
      ok: true,
      provider: 'sql',
      createdAccounts,
      linkedAccounts,
      createdProducts: 0,
      linkedProducts: 0
    };
  } catch (err) {
    console.error('[account] syncSqlAccounts', err);
    return { ok: false, reason: 'SYNC_SQL_FAILED', message: err.message };
  }
}

/**
 * Sync accounts by visitor's client account system: list existing → find by title → create if missing → save mapping.
 * xero/bukku/autocount/sql all supported (先查有没有户口，过后才去 create).
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
  if (provider === 'autocount') return syncAutoCountAccounts(email);
  if (provider === 'sql') return syncSqlAccounts(email);
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
  syncAccounts
};
