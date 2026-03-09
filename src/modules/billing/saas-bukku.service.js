/**
 * SaaS 平台自家 Bukku：僅用於 indoor admin 的 manual topup & manual renew 開 cash invoice。
 * 憑證從 secret manager 注入：BUKKU_SAAS_API_KEY、BUKKU_SAAS_SUBDOMAIN。
 * 科目/產品：pricingplan=15, topupcredit=16, account=70, 收款 manual=3(Bank)、Stripe=71。
 * 每個 client 在 Bukku 對應一個 contact（clientdetail.bukku_saas_contact_id），開單時用該 contact。
 */

const bukkurequest = require('../bukku/wrappers/bukkurequest');
const pool = require('../../config/db');

const PRODUCT_PRICINGPLAN = Number(process.env.BUKKU_SAAS_PRODUCT_PRICINGPLAN || '15');
const PRODUCT_TOPUPCREDIT = Number(process.env.BUKKU_SAAS_PRODUCT_TOPUPCREDIT || '16');
const ACCOUNT_REVENUE = Number(process.env.BUKKU_SAAS_ACCOUNT || '70');
const PAYMENT_BANK = Number(process.env.BUKKU_SAAS_PAYMENT_BANK || '3');
const PAYMENT_STRIPE = Number(process.env.BUKKU_SAAS_PAYMENT_STRIPE || '71');

function getSaasBukkuCreds() {
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) {
    throw new Error('SaaS Bukku not configured: set BUKKU_SAAS_API_KEY and BUKKU_SAAS_SUBDOMAIN (or from secret manager)');
  }
  return { token: String(token).trim(), subdomain: String(subdomain).trim() };
}

/** Item description 最長 500（Bukku form_items.description）。 */
const DESCRIPTION_MAX = 500;

/**
 * 組裝 Topup 開單的 item description：client name, when, payment method, amount, currency, credit before, credit after.
 */
function buildTopupDescription({ clientName, when, paymentMethod, amount, currency, creditBefore, creditAfter }) {
  const lines = [
    `Client: ${clientName || '-'}`,
    `When: ${when || '-'}`,
    `Payment: ${paymentMethod || '-'}`,
    `Amount: ${amount != null ? amount : '-'} ${currency || ''}`,
    `Credit before: ${creditBefore != null ? creditBefore : '-'}`,
    `Credit after: ${creditAfter != null ? creditAfter : '-'}`
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
 * 在平台 SaaS Bukku 建立一筆 contact（customer），用於開單時指定客戶。
 * @param {{ legalName: string, email?: string, defaultCurrencyCode?: string }}
 * @returns {Promise<{ ok: boolean, contactId?: number, error?: string }>}
 */
async function createSaasBukkuContact({ legalName, email, defaultCurrencyCode }) {
  const name = String(legalName || 'Client').trim() || 'Client';
  const { token, subdomain } = getSaasBukkuCreds();
  const currency = (defaultCurrencyCode && String(defaultCurrencyCode).trim())
    ? String(defaultCurrencyCode).toUpperCase().slice(0, 10)
    : 'MYR';
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
    return { ok: false, error: res?.error || 'SaaS Bukku create contact failed' };
  }
  const data = res.data;
  const contactId = data?.id ?? data?.contact?.id;
  const idNum = contactId != null ? Number(contactId) : undefined;
  return { ok: true, contactId: idNum };
}

/**
 * 在平台 SaaS Bukku 用 search 查 contacts，若有與 email 或 legal_name 完全一致則回傳該 contact id。
 * @param {{ email?: string, legalName: string }} opts
 * @returns {Promise<number|null>} contactId 或 null（未找到或 API 失敗）
 */
async function findSaasBukkuContactByEmailOrName({ email, legalName }) {
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) return null;
  const searchTerm = (email && String(email).trim()) || (legalName && String(legalName).trim()) || '';
  if (!searchTerm) return null;

  const res = await bukkurequest({
    method: 'get',
    endpoint: '/contacts',
    token,
    subdomain,
    params: { search: searchTerm.slice(0, 100), type: 'customer', page_size: 50 }
  });
  if (!res || res.ok !== true || !res.data) return null;
  const list = Array.isArray(res.data) ? res.data : res.data?.contacts || res.data?.data || [];
  const wantEmail = email ? String(email).trim().toLowerCase() : '';
  const wantName = (legalName || '').trim().toLowerCase();

  for (const c of list) {
    const cId = c?.id != null ? Number(c.id) : null;
    if (cId == null) continue;
    if (wantEmail && (c?.email || '').trim().toLowerCase() === wantEmail) return cId;
    if (wantName && (c?.legal_name || c?.legalName || '').trim().toLowerCase() === wantName) return cId;
  }
  return null;
}

/**
 * 取得 client 對應的 Bukku contact_id；若 DB 有則直接回傳；否則先依 email/名字在 Bukku 查詢，有則回傳並寫回 DB，沒有才 create。
 * @param {string} clientId - clientdetail.id
 * @returns {Promise<number|null>} contactId 或 null（未配置 Bukku 或建立失敗時）
 */
async function ensureClientBukkuContact(clientId) {
  if (!clientId) return null;
  const token = process.env.BUKKU_SAAS_API_KEY || process.env.BUKKU_SAAS_BUKKU_API_KEY;
  const subdomain = process.env.BUKKU_SAAS_SUBDOMAIN || process.env.BUKKU_SAAS_BUKKUSUBDOMAIN;
  if (!token || !subdomain) return null;

  const [rows] = await pool.query(
    'SELECT id, title, email, currency, bukku_saas_contact_id FROM clientdetail WHERE id = ? LIMIT 1',
    [clientId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  if (row.bukku_saas_contact_id != null && Number(row.bukku_saas_contact_id) > 0) {
    return Number(row.bukku_saas_contact_id);
  }

  const legalName = (row.title || '').trim() || `Client ${row.id}`.slice(0, 100);
  const email = row.email ? String(row.email).trim() : undefined;
  const existingId = await findSaasBukkuContactByEmailOrName({ email, legalName });
  if (existingId != null) {
    await pool.query('UPDATE clientdetail SET bukku_saas_contact_id = ?, updated_at = NOW() WHERE id = ?', [existingId, clientId]);
    return existingId;
  }

  const currency = (row.currency && String(row.currency).trim()) ? String(row.currency).toUpperCase() : 'MYR';
  const created = await createSaasBukkuContact({
    legalName,
    email,
    defaultCurrencyCode: currency
  });
  if (!created.ok || created.contactId == null) {
    console.warn('[saas-bukku] ensureClientBukkuContact create failed', clientId, created.error);
    return null;
  }
  await pool.query('UPDATE clientdetail SET bukku_saas_contact_id = ?, updated_at = NOW() WHERE id = ?', [created.contactId, clientId]);
  return created.contactId;
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
 * @param {string} opts.description - 單據說明（建議用 buildTopupDescription / buildPlanDescription）
 * @param {string} [opts.currencyCode='MYR']
 * @returns {Promise<{ ok: boolean, invoiceId?: number, invoiceUrl?: string, error?: string }>}
 */
async function createSaasBukkuCashInvoice(opts) {
  const {
    contactId,
    productId,
    accountId,
    amount,
    paidDate,
    paymentAccountId,
    description,
    currencyCode = 'MYR'
  } = opts;
  if (!contactId || amount == null || amount <= 0 || !paidDate || !paymentAccountId) {
    return { ok: false, error: 'missing or invalid params for SaaS Bukku cash invoice' };
  }
  const { token, subdomain } = getSaasBukkuCreds();
  const dateIso = String(paidDate).slice(0, 10) + (paidDate.length <= 10 ? 'T00:00:00.000Z' : '');
  const payload = {
    payment_mode: 'cash',
    contact_id: Number(contactId),
    date: dateIso,
    currency_code: (currencyCode || 'MYR').toUpperCase(),
    exchange_rate: 1,
    tax_mode: 'exclusive',
    title: (description || 'SaaS indoor').slice(0, 255),
    description: (description || '').slice(0, 255),
    form_items: [
      {
        type: null,
        account_id: Number(accountId) || ACCOUNT_REVENUE,
        description: (description || 'Indoor').slice(0, DESCRIPTION_MAX),
        unit_price: Number(amount),
        quantity: 1,
        product_id: Number(productId) || undefined
      }
    ],
    deposit_items: [
      { account_id: Number(paymentAccountId), amount: Number(amount) }
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
    return { ok: false, error: res?.error || 'SaaS Bukku invoice failed' };
  }
  const data = res.data;
  const invoiceId = data?.id ?? data?.invoice?.id;
  const idNum = invoiceId != null ? Number(invoiceId) : undefined;
  let invoiceUrl = null;
  if (idNum != null && subdomain) {
    invoiceUrl = `https://${String(subdomain).trim()}.bukku.my/invoices/${idNum}`.replace(/\/+/g, '/');
  }
  return { ok: true, invoiceId: idNum, invoiceUrl: invoiceUrl || undefined };
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
  buildTopupDescription,
  buildPlanDescription,
  createSaasBukkuContact,
  ensureClientBukkuContact,
  createSaasBukkuCashInvoice,
  createSaasBukkuCashInvoiceIfConfigured,
  PRODUCT_PRICINGPLAN,
  PRODUCT_TOPUPCREDIT,
  ACCOUNT_REVENUE,
  PAYMENT_BANK,
  PAYMENT_STRIPE
};
