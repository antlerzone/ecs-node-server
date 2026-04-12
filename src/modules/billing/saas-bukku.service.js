/**
 * SaaS 平台自家 Bukku：僅用於 indoor admin 的 manual topup & manual renew 開 cash invoice。
 * 憑證從 secret manager 注入：BUKKU_SAAS_API_KEY、BUKKU_SAAS_SUBDOMAIN。
 * 科目/產品：pricingplan=15, topupcredit=16, account=70, 收款 manual=3(Bank)、Stripe=71、Xendit/FPX 可設 BUKKU_SAAS_PAYMENT_XENDIT。
 * 每個 client 在 Bukku 對應一個 contact（operatordetail.bukku_saas_contact_id），開單時用該 contact。
 */

const bukkurequest = require('../bukku/wrappers/bukkurequest');
const pool = require('../../config/db');

const PRODUCT_PRICINGPLAN = Number(process.env.BUKKU_SAAS_PRODUCT_PRICINGPLAN || '15');
const PRODUCT_TOPUPCREDIT = Number(process.env.BUKKU_SAAS_PRODUCT_TOPUPCREDIT || '16');
const ACCOUNT_REVENUE = Number(process.env.BUKKU_SAAS_ACCOUNT || '70');
const PAYMENT_BANK = Number(process.env.BUKKU_SAAS_PAYMENT_BANK || '3');
const PAYMENT_STRIPE = Number(process.env.BUKKU_SAAS_PAYMENT_STRIPE || '71');
/** Portal Xendit/Payex SaaS top-up deposit line in Bukku; default same account as Stripe (online), overridable. */
const PAYMENT_XENDIT = Number(
  process.env.BUKKU_SAAS_PAYMENT_XENDIT ||
    process.env.BUKKU_SAAS_PAYMENT_PAYEX ||
    String(PAYMENT_STRIPE)
);

/** Cleanlemons portal subscription/add-on → platform Bukku (override via env; defaults align with cleanlemons org chart). */
const PRODUCT_CLEANLEMON = Number(process.env.BUKKU_SAAS_CLEANLEMON_PRODUCT_ID || '19');
const ACCOUNT_CLEANLEMON_REVENUE = Number(process.env.BUKKU_SAAS_CLEANLEMON_ACCOUNT_ID || '60');
const PAYMENT_CLEANLEMON_STRIPE = Number(process.env.BUKKU_SAAS_CLEANLEMON_STRIPE_ACCOUNT_ID || '61');
const PAYMENT_CLEANLEMON_BANK = Number(process.env.BUKKU_SAAS_CLEANLEMON_BANK_ACCOUNT_ID || process.env.BUKKU_SAAS_PAYMENT_BANK || '3');
const PAYMENT_CLEANLEMON_CASH = Number(
  process.env.BUKKU_SAAS_CLEANLEMON_CASH_ACCOUNT_ID || process.env.BUKKU_SAAS_CLEANLEMON_BANK_ACCOUNT_ID || process.env.BUKKU_SAAS_PAYMENT_BANK || '3'
);

function getSaasBukkuCreds() {
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) {
    throw new Error('SaaS Bukku not configured: set BUKKU_SAAS_API_KEY and BUKKU_SAAS_SUBDOMAIN (or from secret manager)');
  }
  return { token: String(token).trim(), subdomain: String(subdomain).trim() };
}

/**
 * Coliving indoor / pricing → BUKKU_SAAS_* (e.g. colivingmanagement.bukku.my).
 * Cleanlemons portal subscription → BUKKU_SAAS_CLEANLEMONS_* (e.g. cleanlemons.bukku.my) when both set; else warn + fallback to Coliving creds.
 * @param {boolean} forCleanlemons
 * @returns {{ token: string, subdomain: string, usedCleanlemonsEnv: boolean }}
 */
function getSaasBukkuCredsResolved(forCleanlemons) {
  if (forCleanlemons) {
    const t = process.env.BUKKU_SAAS_CLEANLEMONS_API_KEY || process.env.BUKKU_SAAS_CLEANLEMON_API_KEY;
    const s = process.env.BUKKU_SAAS_CLEANLEMONS_SUBDOMAIN || process.env.BUKKU_SAAS_CLEANLEMON_SUBDOMAIN;
    if (t && String(t).trim() && s && String(s).trim()) {
      return {
        token: String(t).trim(),
        subdomain: String(s).trim(),
        usedCleanlemonsEnv: true,
      };
    }
    console.warn(
      '[saas-bukku] BUKKU_SAAS_CLEANLEMONS_API_KEY / BUKKU_SAAS_CLEANLEMONS_SUBDOMAIN not set; using Coliving BUKKU_SAAS_* (wrong org for Cleanlemons invoices)'
    );
  }
  const { token, subdomain } = getSaasBukkuCreds();
  return { token, subdomain, usedCleanlemonsEnv: false };
}

/**
 * 檢查 env 是否已配置 SaaS Bukku（不拋錯）。供前端/Admin 判斷能否開單。
 * @returns {{ configured: boolean, hasApiKey: boolean, hasSubdomain: boolean }}
 */
function checkSaasBukkuConfigured() {
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  return {
    configured: !!(token && String(token).trim() && subdomain && String(subdomain).trim()),
    hasApiKey: !!(token && String(token).trim()),
    hasSubdomain: !!(subdomain && String(subdomain).trim())
  };
}

/** Cleanlemons-dedicated org env; if false, code falls back to Coliving BUKKU_SAAS_*. */
function checkSaasBukkuConfiguredForCleanlemons() {
  const t = process.env.BUKKU_SAAS_CLEANLEMONS_API_KEY || process.env.BUKKU_SAAS_CLEANLEMON_API_KEY;
  const s = process.env.BUKKU_SAAS_CLEANLEMONS_SUBDOMAIN || process.env.BUKKU_SAAS_CLEANLEMON_SUBDOMAIN;
  const dedicated = !!(t && String(t).trim() && s && String(s).trim());
  const coliving = checkSaasBukkuConfigured().configured;
  return {
    configured: dedicated || coliving,
    dedicatedCleanlemonsOrg: dedicated,
    fallsBackToColiving: !dedicated && coliving,
  };
}

/** Item description 最長 500（Bukku form_items.description）。 */
const DESCRIPTION_MAX = 500;

/**
 * 發票抬頭（title / 單據 description）：短句，避免整張單被長字串洗版。
 */
function buildTopupInvoiceTitle({ creditAmount }) {
  const n = creditAmount != null ? Number(creditAmount) : 0;
  return `topup ${Number.isFinite(n) ? n : 0} credit`.slice(0, 255);
}

/**
 * 明細行 description：儲值點數、時間、收款方式、實付金額、credit before/after（抬頭仍用 buildTopupInvoiceTitle）。
 * paymentMethod 例：Stripe、Xendit、Bank、Payex
 */
function buildTopupLineItemDescription({
  creditAmount,
  when,
  paymentMethod,
  amount,
  currency,
  creditBefore,
  creditAfter
}) {
  const cr = creditAmount != null ? Number(creditAmount) : NaN;
  const amt = amount != null ? Number(amount) : NaN;
  const before = creditBefore != null ? Number(creditBefore) : NaN;
  const after = creditAfter != null ? Number(creditAfter) : NaN;
  const cur = (currency || '').toString().trim().toUpperCase();
  const amountStr = Number.isFinite(amt) ? String(amt) : '-';
  const lines = [
    `topup ${Number.isFinite(cr) ? cr : '-'} credit`,
    `When: ${when != null && String(when).trim() ? String(when).trim() : '-'}`,
    `Payment: ${paymentMethod != null && String(paymentMethod).trim() ? String(paymentMethod).trim() : '-'}`,
    cur ? `Amount: ${amountStr} ${cur}` : `Amount: ${amountStr}`,
    `Credit before: ${Number.isFinite(before) ? before : '-'}`,
    `Credit after: ${Number.isFinite(after) ? after : '-'}`
  ];
  return lines.join('\n').slice(0, DESCRIPTION_MAX);
}


/**
 * 組裝 Pricing plan 開單的 item description：client name, when, payment method, amount, currency, plan title.
 */
function buildPlanDescription({ clientName, when, paymentMethod, amount, currency, planTitle }) {
  const lines = [
    `Client: ${clientName || '-'}`,
    `When: ${when || '-'}`,
    `Payment: ${paymentMethod || '-'}`,
    `Amount: ${amount != null ? amount : '-'} ${currency || ''}`,
    `Plan: ${planTitle || '-'}`
  ];
  return lines.join('\n').slice(0, DESCRIPTION_MAX);
}

/**
 * Cleanlemons platform cash-invoice line text (Bukku form_items.description).
 * companyName / email 应由调用方从 `cln_operatordetail` 读出；activeDate 一般为吉隆坡当日（记账参考日）。
 */
function buildCleanlemonPlatformLineDescription({ companyName, activeDate, paymentLabel, email, itemSummary }) {
  const lines = [
    `Company name: ${companyName || '-'}`,
    `Active date: ${activeDate || '-'}`,
    `Payment: ${paymentLabel || '-'}`,
    `Email: ${email || '-'}`,
  ];
  if (itemSummary) lines.push(`Service: ${itemSummary}`);
  return lines.join('\n').slice(0, DESCRIPTION_MAX);
}

/**
 * 在平台 SaaS Bukku 建立一筆 contact（customer），用於開單時指定客戶。
 * @param {{ legalName: string, email?: string, defaultCurrencyCode?: string }}
 * @returns {Promise<{ ok: boolean, contactId?: number, error?: string }>}
 */
async function createSaasBukkuContact({ legalName, email, defaultCurrencyCode, forCleanlemons = false }) {
  const name = String(legalName || 'Client').trim() || 'Client';
  const { token, subdomain } = getSaasBukkuCredsResolved(Boolean(forCleanlemons));
  const orgTag = forCleanlemons ? 'cleanlemons' : 'coliving';
  const currency =
    defaultCurrencyCode != null && String(defaultCurrencyCode).trim()
      ? String(defaultCurrencyCode).toUpperCase().slice(0, 10)
      : '';
  if (!currency) {
    console.warn('[saas-bukku] Bukku POST /contacts skipped (no currency)', { org: orgTag, subdomain });
    return { ok: false, error: 'MISSING_CLIENT_CURRENCY' };
  }
  console.log('[saas-bukku] Bukku POST /contacts', {
    org: orgTag,
    subdomain: subdomain || '(missing)',
    legalNameLen: name.length,
    hasEmail: Boolean(email && String(email).trim()),
    currency,
  });
  const payload = {
    entity_type: 'MALAYSIAN_COMPANY',
    legal_name: name.slice(0, 100),
    types: ['customer'],
    default_currency_code: currency,
    ...(email ? { email: String(email).trim().slice(0, 255) } : {})
  };
  const res = await bukkurequest({
    method: 'post',
    endpoint: '/contacts',
    token,
    subdomain,
    data: payload
  });
  if (!res || res.ok === false) {
    console.warn('[saas-bukku] Bukku POST /contacts failed', { org: orgTag, subdomain, error: res?.error || 'unknown' });
    return { ok: false, error: res?.error || 'SaaS Bukku create contact failed' };
  }
  const data = res.data;
  const contactId = data?.id ?? data?.contact?.id;
  const idNum = contactId != null ? Number(contactId) : undefined;
  console.log('[saas-bukku] Bukku POST /contacts ok', { org: orgTag, subdomain, contactId: idNum });
  return { ok: true, contactId: idNum };
}

/** Normalize Bukku list response shapes (GET /contacts). */
function normalizeBukkuContactsList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.contacts)) return raw.contacts;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.results)) return raw.results;
  if (raw.data && Array.isArray(raw.data.contacts)) return raw.data.contacts;
  if (raw.data && Array.isArray(raw.data.data)) return raw.data.data;
  return [];
}

function normLegalKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bukku contact `types` / `type` as lowercase strings (customer | supplier | employee). */
function contactBukkuTypesLower(c) {
  const t = c?.types ?? c?.type;
  if (t == null) return [];
  if (Array.isArray(t)) {
    return t
      .map((x) => {
        if (typeof x === 'string') return x.toLowerCase();
        if (x && typeof x === 'object' && x.code != null) return String(x.code).toLowerCase();
        if (x && typeof x === 'object' && x.name != null) return String(x.name).toLowerCase();
        return String(x).toLowerCase();
      })
      .filter(Boolean);
  }
  return [String(t).toLowerCase()];
}

function unwrapBukkuContactReadBody(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.contact && typeof data.contact === 'object') return data.contact;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
  return data;
}

/**
 * Sales (cash) invoice requires contact to include type `customer`. Supplier-only → 422 "contact selected is invalid".
 * @returns {Promise<{ ok: boolean, contactId?: number, error?: string }>}
 */
async function ensureSaasBukkuContactHasCustomerType(contactId, forCleanlemons) {
  const orgTag = forCleanlemons ? 'cleanlemons' : 'coliving';
  const id = Number(contactId);
  if (!id || id <= 0) return { ok: false, error: 'bad_contact_id' };
  const { token, subdomain } = getSaasBukkuCredsResolved(Boolean(forCleanlemons));

  const got = await bukkurequest({
    method: 'get',
    endpoint: `/contacts/${id}`,
    token,
    subdomain,
  });
  if (!got || got.ok !== true) {
    console.warn('[saas-bukku] GET /contacts/:id failed (customer type check)', { id, org: orgTag, error: got?.error });
    return { ok: false, error: got?.error || 'get_contact_failed' };
  }

  const raw = unwrapBukkuContactReadBody(got.data);
  if (!raw || typeof raw !== 'object') {
    console.warn('[saas-bukku] GET /contacts/:id unexpected body', { id, org: orgTag });
    return { ok: false, error: 'unexpected_contact_body' };
  }

  const existingLower = contactBukkuTypesLower(raw);
  if (existingLower.includes('customer')) {
    console.log('[saas-bukku] contact already eligible for sales (has customer type)', { id, org: orgTag });
    return { ok: true, contactId: id };
  }

  const prev = Array.isArray(raw.types) ? raw.types : existingLower.length ? existingLower : [];
  const withCustomer = [...new Set([...prev.map((x) => String(x).toLowerCase()), 'customer'])];

  let put = await bukkurequest({
    method: 'put',
    endpoint: `/contacts/${id}`,
    token,
    subdomain,
    data: { types: withCustomer },
  });

  if (!put || put.ok !== true) {
    const payload = {
      entity_type: raw.entity_type,
      legal_name: raw.legal_name ?? raw.legalName,
      email: raw.email,
      default_currency_code: raw.default_currency_code ?? raw.defaultCurrencyCode,
      types: withCustomer,
    };
    const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v != null && v !== ''));
    put = await bukkurequest({
      method: 'put',
      endpoint: `/contacts/${id}`,
      token,
      subdomain,
      data: cleaned,
    });
  }

  if (!put || put.ok !== true) {
    console.warn('[saas-bukku] PUT /contacts/:id add customer type failed', {
      id,
      org: orgTag,
      error: put?.error,
    });
    return { ok: false, error: put?.error || 'put_contact_failed' };
  }

  console.log('[saas-bukku] added customer type to contact (for sales invoice)', {
    id,
    org: orgTag,
    types: withCustomer,
  });
  return { ok: true, contactId: id };
}

/** Distinct search strings: email, full legal name, then meaningful words (Bukku search often misses email). */
function bukkuContactSearchTerms(email, legalName) {
  const terms = [];
  const e = email && String(email).trim();
  const n = legalName && String(legalName).trim();
  if (e) terms.push(e);
  if (n) terms.push(n);
  if (n) {
    for (const w of n.split(/\s+/)) {
      if (w.length >= 3 && !terms.includes(w)) terms.push(w);
    }
  }
  return [...new Set(terms.map((t) => String(t).slice(0, 100)).filter(Boolean))];
}

/**
 * @param {{ requireCustomerInTypes?: boolean }} opts - If true, skip rows whose `types` is non-empty but has no `customer` (supplier-only).
 */
function pickContactIdFromBukkuList(list, email, legalName, opts = {}) {
  const requireCustomerInTypes = opts.requireCustomerInTypes === true;
  const wantEmail = email ? String(email).trim().toLowerCase() : '';
  const wantName = normLegalKey(legalName);
  for (const c of list) {
    const cId = c?.id != null ? Number(c.id) : null;
    if (cId == null || cId <= 0) continue;
    const types = contactBukkuTypesLower(c);
    if (requireCustomerInTypes && types.length > 0 && !types.includes('customer')) continue;

    if (wantEmail && (c?.email || '').trim().toLowerCase() === wantEmail) return cId;
    const ln = normLegalKey(c?.legal_name || c?.legalName || '');
    if (wantName && ln === wantName) return cId;
  }
  return null;
}

/** True when POST /contacts rejects because legal_name already exists in org. */
function isBukkuDuplicateLegalNameError(err) {
  if (err == null) return false;
  const parts = [];
  if (typeof err === 'string') parts.push(err);
  else {
    try {
      parts.push(JSON.stringify(err));
    } catch {
      parts.push(String(err));
    }
  }
  const blob = parts.join(' ').toLowerCase();
  if (!blob.includes('legal')) return /already been taken|already exists|duplicate/i.test(blob);
  return /already been taken|already exists|taken|duplicate/i.test(blob);
}

async function fetchSaasBukkuContactsSearch({ token, subdomain, search, customerTypeOnly }) {
  const params = { search: String(search).slice(0, 100), page_size: 50 };
  if (customerTypeOnly) params.type = 'customer';
  return bukkurequest({
    method: 'get',
    endpoint: '/contacts',
    token,
    subdomain,
    params
  });
}

/**
 * 在平台 SaaS Bukku 用 search 查 contacts，若有與 email 或 legal_name 完全一致則回傳該 contact id。
 * 會用多組關鍵字（email、公司全名、片段）並在 `type=customer` 無結果時再試不帶 type（Bukku 回傳結構差異大）。
 * @param {{ email?: string, legalName: string }} opts
 * @returns {Promise<number|null>} contactId 或 null（未找到或 API 失敗）
 */
async function findSaasBukkuContactByEmailOrName({ email, legalName, forCleanlemons = false }) {
  const { token, subdomain } = getSaasBukkuCredsResolved(Boolean(forCleanlemons));
  const orgTag = forCleanlemons ? 'cleanlemons' : 'coliving';
  if (!token || !subdomain) return null;

  const terms = bukkuContactSearchTerms(email, legalName);
  if (!terms.length) return null;

  const seenIds = new Set();
  /** @type {object[]} */
  let merged = [];

  for (const searchTerm of terms) {
    for (const customerTypeOnly of [true, false]) {
      console.log('[saas-bukku] Bukku GET /contacts (search)', {
        org: orgTag,
        subdomain,
        searchLen: searchTerm.length,
        customerTypeOnly,
      });
      const res = await fetchSaasBukkuContactsSearch({
        token,
        subdomain,
        search: searchTerm,
        customerTypeOnly
      });
      if (!res || res.ok !== true || !res.data) {
        console.warn('[saas-bukku] Bukku GET /contacts failed', { org: orgTag, ok: res?.ok });
        continue;
      }
      const list = normalizeBukkuContactsList(res.data);
      for (const c of list) {
        const id = c?.id != null ? Number(c.id) : null;
        if (id == null || id <= 0 || seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(c);
      }
      const hitCustomer = pickContactIdFromBukkuList(merged, email, legalName, { requireCustomerInTypes: true });
      if (hitCustomer != null) {
        console.log('[saas-bukku] Bukku contact matched after merge (customer-eligible)', {
          org: orgTag,
          contactId: hitCustomer,
          mergedCount: merged.length,
        });
        return hitCustomer;
      }
    }
  }

  const finalCustomer = pickContactIdFromBukkuList(merged, email, legalName, { requireCustomerInTypes: true });
  if (finalCustomer != null) {
    console.log('[saas-bukku] Bukku contact matched (final, customer-eligible)', {
      org: orgTag,
      contactId: finalCustomer,
      mergedCount: merged.length,
    });
    return finalCustomer;
  }

  const anyMatched = pickContactIdFromBukkuList(merged, email, legalName, { requireCustomerInTypes: false });
  if (anyMatched != null) {
    console.log('[saas-bukku] Bukku contact matched but may be supplier-only — ensuring customer type', {
      org: orgTag,
      contactId: anyMatched,
      mergedCount: merged.length,
    });
    const ensured = await ensureSaasBukkuContactHasCustomerType(anyMatched, forCleanlemons);
    if (ensured.ok) return ensured.contactId;
    console.warn('[saas-bukku] could not add customer type to matched contact', {
      org: orgTag,
      contactId: anyMatched,
      error: ensured.error,
    });
  }

  console.log('[saas-bukku] Bukku GET /contacts no usable match', { org: orgTag, subdomain, mergedCount: merged.length });
  return null;
}

/**
 * 取得 client（operator）對應的 SaaS platform Bukku contact_id。
 * 流程（與 booking 頁類似）：用 operatordetail 的 email + title(name) 在平台 Bukku 先 search；
 * 有則取 id 寫回 operatordetail.bukku_saas_contact_id；沒有則 create operator as customer，取 id 寫回 DB。
 * 之後即可用此 contactId 開 cash invoice。
 * @param {string} clientId - operatordetail.id
 * @returns {Promise<number|null>} contactId 或 null（未配置 Bukku 或建立失敗時）
 */
async function ensureClientBukkuContact(clientId) {
  if (!clientId) {
    console.log('[saas-bukku] ensureClientBukkuContact: no clientId');
    return null;
  }
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) {
    console.log('[saas-bukku] ensureClientBukkuContact: env not set (BUKKU_SAAS_API_KEY/BUKKU_SAAS_SUBDOMAIN)', { hasToken: !!token, hasSubdomain: !!subdomain });
    return null;
  }

  const [rows] = await pool.query(
    'SELECT id, title, email, currency, bukku_saas_contact_id FROM operatordetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) {
    console.log('[saas-bukku] ensureClientBukkuContact: client not found', clientId);
    return null;
  }
  const row = rows[0];
  if (row.bukku_saas_contact_id != null && Number(row.bukku_saas_contact_id) > 0) {
    const cached = Number(row.bukku_saas_contact_id);
    console.log('[saas-bukku] ensureClientBukkuContact: using existing bukku_saas_contact_id', cached, 'clientId=', clientId);
    const ens = await ensureSaasBukkuContactHasCustomerType(cached, false);
    return ens.ok ? ens.contactId : null;
  }

  const legalName = (row.title || '').trim() || `Client ${row.id}`.slice(0, 100);
  const email = row.email ? String(row.email).trim() : undefined;
  const existingId = await findSaasBukkuContactByEmailOrName({ email, legalName });
  if (existingId != null) {
    await pool.query('UPDATE operatordetail SET bukku_saas_contact_id = ?, updated_at = NOW() WHERE id = ?', [existingId, clientId]);
    console.log('[saas-bukku] ensureClientBukkuContact: found by email/name, saved contactId=', existingId, 'clientId=', clientId);
    const ens = await ensureSaasBukkuContactHasCustomerType(existingId, false);
    return ens.ok ? ens.contactId : null;
  }

  const currency = row.currency && String(row.currency).trim() ? String(row.currency).toUpperCase() : '';
  if (!currency) {
    console.warn('[saas-bukku] ensureClientBukkuContact: client currency missing; clientId=', clientId);
    return null;
  }
  const created = await createSaasBukkuContact({
    legalName,
    email,
    defaultCurrencyCode: currency
  });
  if (!created.ok || created.contactId == null) {
    console.warn('[saas-bukku] ensureClientBukkuContact create failed', clientId, created.error);
    return null;
  }
  await pool.query('UPDATE operatordetail SET bukku_saas_contact_id = ?, updated_at = NOW() WHERE id = ?', [created.contactId, clientId]);
  console.log('[saas-bukku] ensureClientBukkuContact: created new contact, contactId=', created.contactId, 'clientId=', clientId);
  const ensNew = await ensureSaasBukkuContactHasCustomerType(created.contactId, false);
  return ensNew.ok ? ensNew.contactId : null;
}

/**
 * 用平台 Bukku 開一筆 cash invoice（即開即收，deposit 入指定 account）。
 * @param {object} opts
 * @param {number} opts.contactId - Bukku contact_id（客戶/公司）
 * @param {number} opts.productId - 產品 id（15=pricingplan, 16=topupcredit）
 * @param {number} opts.accountId - 收入科目（70）
 * @param {number} opts.amount - 金額（主幣別，如 MYR）
 * @param {string} opts.paidDate - YYYY-MM-DD
 * @param {number} opts.paymentAccountId - 收款科目（3=Bank manual, 71=Stripe）
 * @param {number} [opts.depositPaymentMethodId] - Bukku「付款方式」ID（與 chart of accounts 不同）；設後收款區會顯示名稱而非空白
 * @param {string} [opts.description] - 若未傳 invoiceTitle / lineItemDescription，則 title、單據 description、明細共用此字串
 * @param {string} [opts.invoiceTitle] - 短抬頭（例如 topup N credit）
 * @param {string} [opts.lineItemDescription] - 明細行完整說明（含 credit before/after）
 * @param {string} opts.currencyCode
 * @returns {Promise<{ ok: boolean, invoiceId?: string, invoiceNumericId?: number, invoiceUrl?: string, lineItemDescription?: string, error?: string }>}
 */
async function createSaasBukkuCashInvoice(opts) {
  const {
    contactId,
    productId,
    accountId,
    amount,
    paidDate,
    paymentAccountId,
    depositPaymentMethodId,
    description,
    invoiceTitle,
    lineItemDescription,
    currencyCode,
    forCleanlemons = false
  } = opts;
  if (!contactId || amount == null || amount <= 0 || !paidDate || !paymentAccountId) {
    return { ok: false, error: 'missing or invalid params for SaaS Bukku cash invoice' };
  }
  if (currencyCode == null || String(currencyCode).trim() === '') {
    return { ok: false, error: 'MISSING_CLIENT_CURRENCY' };
  }
  const currencyCodeUpper = String(currencyCode).trim().toUpperCase();
  const { token, subdomain } = getSaasBukkuCredsResolved(Boolean(forCleanlemons));
  const orgTag = forCleanlemons ? 'cleanlemons' : 'coliving';
  console.log('[saas-bukku] Bukku POST /sales/invoices (cash)', {
    org: orgTag,
    subdomain: subdomain || '(missing)',
    contactId: Number(contactId),
    amount: Number(amount),
    currency: currencyCodeUpper,
    paidDate: String(paidDate).trim().slice(0, 10),
    paymentAccountId: Number(paymentAccountId),
    productId: Number(productId) || undefined,
  });
  // Bukku API requires date in Y-m-d format only (e.g. 2025-03-15), not ISO with time
  const dateYmd = String(paidDate).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return { ok: false, error: 'paidDate must be YYYY-MM-DD for Bukku' };
  }
  const titleStr = (invoiceTitle ?? description ?? 'SaaS indoor').slice(0, 255);
  const docDescStr = (invoiceTitle ?? description ?? '').slice(0, 255);
  const lineDescStr = (lineItemDescription ?? description ?? 'Indoor').slice(0, DESCRIPTION_MAX);
  const payload = {
    payment_mode: 'cash',
    contact_id: Number(contactId),
    date: dateYmd,
    currency_code: currencyCodeUpper,
    exchange_rate: 1,
    tax_mode: 'exclusive',
    title: titleStr,
    description: docDescStr,
    form_items: [
      {
        type: null,
        account_id: Number(accountId) || ACCOUNT_REVENUE,
        description: lineDescStr,
        unit_price: Number(amount),
        quantity: 1,
        product_id: Number(productId) || undefined
      }
    ],
    deposit_items: [
      {
        account_id: Number(paymentAccountId),
        amount: Number(amount),
        ...(depositPaymentMethodId != null &&
        Number.isFinite(Number(depositPaymentMethodId)) &&
        Number(depositPaymentMethodId) > 0
          ? { payment_method_id: Number(depositPaymentMethodId) }
          : {}),
      },
    ],
    status: 'ready'
  };
  const res = await bukkurequest({
    method: 'post',
    endpoint: '/sales/invoices',
    token,
    subdomain,
    data: payload
  });
  if (!res || res.ok === false) {
    console.warn('[saas-bukku] Bukku POST /sales/invoices failed', {
      org: orgTag,
      subdomain,
      error: res?.error || 'unknown',
    });
    return { ok: false, error: res?.error || 'SaaS Bukku invoice failed' };
  }
  const data = res.data;
  // Bukku API returns transaction.short_link (e.g. "https://demo.bukku.my/v/123x5") – use as-is per https://developers.bukku.my/
  const rawUrl =
    data?.transaction?.short_link ??
    data?.url ??
    data?.invoice_url ??
    data?.invoice?.url ??
    data?.transaction?.url ??
    data?.transaction?.invoice_url ??
    data?.data?.url ??
    data?.result?.url;
  let invoiceUrl = null;
  if (rawUrl != null && typeof rawUrl === 'string' && String(rawUrl).trim()) {
    invoiceUrl = String(rawUrl).trim();
  }
  // Fallback: only when API did not return a URL, build from subdomain + id
  let invoiceId =
    data?.id ??
    data?.invoice?.id ??
    data?.invoice_id ??
    data?.transaction?.id ??
    data?.transaction?.invoice_id ??
    data?.data?.id ??
    data?.result?.id ??
    data?.payload?.id ??
    (Array.isArray(data?.invoices) && data.invoices[0] != null ? data.invoices[0].id : undefined) ??
    (Array.isArray(data) && data[0] != null ? data[0].id : undefined) ??
    res?.id;
  if (invoiceId == null && data && typeof data === 'object') {
    const idKeys = ['id', 'invoice_id', 'invoiceId'];
    const findId = (obj, seen) => {
      if (!obj || typeof obj !== 'object' || (seen && seen.has(obj))) return null;
      const s = new Set(seen || []);
      s.add(obj);
      for (const k of idKeys) {
        const v = obj[k];
        if (v != null && (typeof v === 'number' && Number.isInteger(v) && v > 0 || typeof v === 'string' && /^\d+$/.test(v))) return typeof v === 'number' ? v : Number(v);
      }
      for (const v of Object.values(obj)) {
        const nested = findId(v, s);
        if (nested != null) return nested;
      }
      return null;
    };
    const found = findId(data, null);
    if (found != null) invoiceId = found;
  }
  const idNum = invoiceId != null ? Number(invoiceId) : undefined;
  const sub = (subdomain && String(subdomain).trim()) || (res.subdomain && String(res.subdomain).trim());
  if (!invoiceUrl && idNum != null && sub) {
    invoiceUrl = `https://${sub}.bukku.my/invoices/${idNum}`.replace(/\/+/g, '/');
  }
  if (idNum == null && data && typeof data === 'object') {
    console.warn('[saas-bukku] createSaasBukkuCashInvoice: no invoice id in response keys:', Object.keys(data).slice(0, 25).join(', '));
  }

  /** Bukku human invoice number e.g. IV-00404 (store in DB / UI); internal id stays numeric for /invoices/:id URLs. */
  function pickDocumentNumber(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const candidates = [
      raw.number,
      raw.number2,
      raw.invoice_number,
      raw.document_number,
      raw.invoice?.number,
      raw.data?.number,
      raw.transaction?.number
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const s = String(c).trim();
      if (s) return s.slice(0, 100);
    }
    return null;
  }
  const docNumber = pickDocumentNumber(data);
  const displayInvoiceId = docNumber || (idNum != null ? String(idNum) : null);

  console.log('[saas-bukku] Bukku POST /sales/invoices ok', {
    org: orgTag,
    subdomain,
    invoiceNumber: displayInvoiceId,
    invoiceNumericId: idNum,
    invoiceUrl: invoiceUrl ? String(invoiceUrl).slice(0, 120) : undefined,
  });
  return {
    ok: true,
    invoiceId: displayInvoiceId != null ? displayInvoiceId : undefined,
    invoiceNumericId: Number.isFinite(idNum) ? idNum : undefined,
    invoiceUrl: invoiceUrl || undefined,
    lineItemDescription: lineDescStr,
  };
}

/**
 * 若已配置平台 Bukku 且傳入 contactId，則開單；否則直接回傳 ok: true（不拋錯）。
 * 供 Stripe webhook 等處呼叫。回傳 invoiceUrl 供寫入 creditlogs / pricingplanlogs。
 */
async function createSaasBukkuCashInvoiceIfConfigured(opts) {
  const contactId = opts?.contactId ?? (process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID ? Number(process.env.BUKKU_SAAS_DEFAULT_CONTACT_ID) : null);
  if (!contactId || contactId <= 0) return { ok: true, skipped: true, reason: 'no_contact_id' };
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) return { ok: true, skipped: true, reason: 'saas_bukku_not_configured' };
  return createSaasBukkuCashInvoice({ ...opts, contactId });
}

module.exports = {
  getSaasBukkuCreds,
  getSaasBukkuCredsResolved,
  checkSaasBukkuConfigured,
  checkSaasBukkuConfiguredForCleanlemons,
  buildTopupInvoiceTitle,
  buildTopupLineItemDescription,
  buildPlanDescription,
  buildCleanlemonPlatformLineDescription,
  createSaasBukkuContact,
  findSaasBukkuContactByEmailOrName,
  isBukkuDuplicateLegalNameError,
  ensureSaasBukkuContactHasCustomerType,
  ensureClientBukkuContact,
  createSaasBukkuCashInvoice,
  createSaasBukkuCashInvoiceIfConfigured,
  PRODUCT_PRICINGPLAN,
  PRODUCT_TOPUPCREDIT,
  PRODUCT_CLEANLEMON,
  ACCOUNT_REVENUE,
  ACCOUNT_CLEANLEMON_REVENUE,
  PAYMENT_BANK,
  PAYMENT_STRIPE,
  PAYMENT_XENDIT,
  PAYMENT_CLEANLEMON_STRIPE,
  PAYMENT_CLEANLEMON_BANK,
  PAYMENT_CLEANLEMON_CASH,
};
