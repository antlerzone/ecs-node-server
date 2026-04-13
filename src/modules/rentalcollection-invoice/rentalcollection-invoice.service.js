/**
 * When rentalcollection rows are written (e.g. from tenant approve → generateFromTenancyByTenancyId),
 * if client has pricing plan + accounting integration: create credit invoice per item (by due date),
 * contact = property owner for owner commission + management fees (credit invoice + payment to Platform Collection, marked paid), else tenant. Write back invoiceid + invoiceurl to rentalcollection.
 * All four platforms: Bukku, Xero, AutoCount, SQL. Invoice ID returned by all; URL: Xero (OnlineInvoice), Bukku (build), AutoCount/SQL (null or config).
 */

const pool = require('../../config/db');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const {
  ensureContactInAccounting,
  ensureBukkuContactHasCustomerTypeForSales,
  writeOwnerAccount,
  writeTenantAccount
} = require('../contact/contact-sync.service');
const { getTodayMalaysiaDate, utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const bukkuRefund = require('../bukku/wrappers/refund.wrapper');
const bukkuBankingExpense = require('../bukku/wrappers/bankingExpense.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const xeroBankTransaction = require('../xero/wrappers/banktransaction.wrapper');
const xeroAccount = require('../xero/wrappers/account.wrapper');
const {
  resolveXeroAccountCode,
  resolveXeroPaymentAccountRef,
  resolveXeroInvoiceLineItemAccount
} = require('../xero/lib/accountCodeResolver');
const { getXeroInvoiceCurrencyForClientId } = require('../xero/lib/invoiceCurrency');
const autocountInvoice = require('../autocount/wrappers/invoice.wrapper');
const autocountReceipt = require('../autocount/wrappers/receipt.wrapper');
const autocountPayment = require('../autocount/wrappers/payment.wrapper');
const sqlInvoice = require('../sqlaccount/wrappers/invoice.wrapper');
const sqlReceipt = require('../sqlaccount/wrappers/receipt.wrapper');
const sqlPayment = require('../sqlaccount/wrappers/payment.wrapper');
const sqlAccount = require('../sqlaccount/wrappers/account.wrapper');
const sqlPaymentMethod = require('../sqlaccount/wrappers/paymentMethod.wrapper');
const { cancelEInvoiceIfEnabled, resolveBukkuCreateInvoiceMyInvoisAction } = require('../einvoice/einvoice.service');
const {
  PLATFORM_COLLECTION_ACCOUNT_ID,
  isIncomeLineUsesPlatformCollectionAccount
} = require('../account/accountLineMappingRules');

const OWNER_COMMISSION_WIX_ID = '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
/** Management fees (Generate Report): cash sales invoice to property owner — same contact path as owner commission. */
const MANAGEMENT_FEES_ACCOUNT_ID = 'a1b2c3d4-0002-4000-8000-000000000002';
const FORFEIT_DEPOSIT_ACCOUNT_ID = '2020b22b-028e-4216-906c-c816dcb33a85';
/** Seed id for Topup Aircond row (0150/0154/0157); also resolved by title if missing. */
const TOPUP_AIRCOND_ACCOUNT_ID = 'a1b2c3d4-1001-4000-8000-000000000101';

// Payment-type titles in account table (we look up by title to get account.id, then account_client / account_json)
const PAYMENT_TYPE_TITLES = {
  bank: ['Bank', 'bank'],
  cash: ['Cash', 'cash'],
  stripe: ['Stripe Current Assets', 'Stripe', 'stripe'],
  xendit: ['Payex Current Assets', 'Payex', 'Xendit', 'xendit'],
  billplz: ['Billplz Current Assets', 'Billplz', 'billplz'],
  deposit: ['Deposit', 'deposit'],
  rental: ['Rent Income', 'Rental', 'rental', 'Rental Income', 'Platform Collection'],
  processing_fee: ['Processing Fee', 'Processing Fees', 'Processing fee', 'Payment Gateway Fee', 'payment_gateway_fee'],
  referral: ['Referral Fees', 'referral'],
  management_fees: ['Management Fees', 'Management Fee', 'management fees'],
  platform_collection: ['Platform Collection', 'platform collection']
};

/**
 * Bukku POST /sales/payments `link_items.target_transaction_id` must be the numeric sales invoice id.
 * Prefer `bukku_invoice_id`; Wix `invoiceid` is often `IV-xxxxx` and must not be passed to Number().
 */
function resolveBukkuSalesTargetTransactionId(row) {
  const b = row.bukku_invoice_id != null && String(row.bukku_invoice_id).trim() !== '' ? String(row.bukku_invoice_id).trim() : '';
  if (b && /^\d+$/.test(b)) return Number(b);
  const inv = row.invoiceid != null && String(row.invoiceid).trim() !== '' ? String(row.invoiceid).trim() : '';
  if (inv && /^\d+$/.test(inv)) return Number(inv);
  return null;
}

/** Accounting APIs often return error bodies as objects (e.g. Bukku axios err.response.data). */
function formatProviderError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function previewJson(value, max = 1200) {
  try {
    return JSON.stringify(value ?? null).slice(0, max);
  } catch {
    return String(value ?? '').slice(0, max);
  }
}

function extractSqlReceiptMeta(res) {
  const data = res?.data;
  const row =
    (Array.isArray(data?.data) && data.data[0]) ||
    (data?.data && typeof data.data === 'object' ? data.data : null) ||
    (data && typeof data === 'object' ? data : null) ||
    {};
  const receiptId =
    row?.dockey ??
    row?.docKey ??
    row?.id ??
    row?.Id ??
    row?.paymentid ??
    row?.paymentId ??
    row?.PaymentID ??
    null;
  const receiptNo =
    row?.docno ??
    row?.docNo ??
    row?.number ??
    row?.Number ??
    row?.documentno ??
    row?.documentNo ??
    null;
  const receiptUrl =
    row?.url ??
    row?.URL ??
    row?.short_link ??
    row?.shortLink ??
    null;
  return {
    receiptId: receiptId != null && String(receiptId).trim() ? String(receiptId).trim() : null,
    receiptNo: receiptNo != null && String(receiptNo).trim() ? String(receiptNo).trim() : null,
    receiptUrl: receiptUrl != null && String(receiptUrl).trim() ? String(receiptUrl).trim() : null,
    snapshot: row && Object.keys(row).length ? row : (data ?? null)
  };
}

/** Structured logs for rental → accounting invoice (grep: invoice-flow). */
function logInvoiceFlow(subtag, payload) {
  try {
    console.log(
      '[invoice-flow]',
      JSON.stringify({
        ts: new Date().toISOString(),
        subtag,
        ...payload
      })
    );
  } catch (_) {
    console.log('[invoice-flow]', subtag, payload);
  }
}

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function normalizeToken(v) {
  return String(v || '').trim().toLowerCase();
}

async function getClientCurrencyCode(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  try {
    const [rows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [clientId]);
    const code = rows[0]?.currency != null ? String(rows[0].currency).trim().toUpperCase() : '';
    if (!code) throw new Error('CLIENT_CURRENCY_MISSING');
    // Accounting-system currency codes supported by this service.
    // (MYR/SGD; if stored as something else, we don't guess.)
    if (code === 'MYR' || code === 'SGD') return code;
    const prefix = code.slice(0, 3);
    if (prefix === 'MYR' || prefix === 'SGD') return prefix;
    throw new Error(`UNSUPPORTED_CLIENT_CURRENCY: ${code}`);
  } catch {
    throw new Error('CLIENT_CURRENCY_READ_FAILED');
  }
}

async function resolveSqlPaymentAccountCode(req, candidates = []) {
  const cleaned = candidates.map((v) => String(v || '').trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const res = await sqlAccount.list(req, { limit: 500 });
  if (!res?.ok) return '';
  const payload = res?.data;
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload) ? payload : []);
  if (!rows.length) return '';

  const wanted = cleaned.map(normalizeToken);
  const byCode = new Map();
  for (const r of rows) {
    const code = String(r?.code || r?.Code || '').trim();
    if (code) byCode.set(normalizeToken(code), code);
  }
  for (const w of wanted) {
    if (byCode.has(w)) return byCode.get(w);
  }

  const pickByKeyword = (keyword) => {
    const k = normalizeToken(keyword);
    if (!k) return '';
    const row = rows.find((r) => {
      const code = normalizeToken(r?.code || r?.Code);
      const desc = normalizeToken(r?.description || r?.Description || r?.description2 || r?.title);
      return code.includes(k) || desc.includes(k);
    });
    return String(row?.code || row?.Code || '').trim();
  };

  // Common fallback keywords from our local labels.
  for (const w of wanted) {
    const c = pickByKeyword(w);
    if (c) return c;
  }
  for (const k of ['bank', 'cash', 'deposit', 'stripe']) {
    if (wanted.some((w) => w.includes(k))) {
      const c = pickByKeyword(k);
      if (c) return c;
    }
  }
  return '';
}

async function resolveSqlPaymentMethodCode(req, candidates = []) {
  const cleaned = candidates.map((v) => String(v || '').trim()).filter(Boolean);
  if (!cleaned.length) return '';
  const res = await sqlPaymentMethod.list(req, { limit: 500 });
  if (!res?.ok) return '';
  const payload = res?.data;
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload) ? payload : []);
  if (!rows.length) return '';
  const wanted = cleaned.map(normalizeToken);
  const byCode = new Map();
  for (const r of rows) {
    const code = String(r?.code || r?.Code || '').trim();
    if (code) byCode.set(normalizeToken(code), code);
  }
  for (const w of wanted) {
    if (byCode.has(w)) return byCode.get(w);
  }
  const pickByKeyword = (keyword) => {
    const k = normalizeToken(keyword);
    const row = rows.find((r) => {
      const code = normalizeToken(r?.code || r?.Code);
      const desc = normalizeToken(r?.description || r?.Description || r?.name || r?.Name);
      return code.includes(k) || desc.includes(k);
    });
    return String(row?.code || row?.Code || '').trim();
  };
  for (const w of wanted) {
    const c = pickByKeyword(w);
    if (c) return c;
  }
  // Fallback when pmmethod list has only opaque codes without description.
  const first = String(rows[0]?.code || rows[0]?.Code || '').trim();
  if (first) return first;
  return '';
}

async function getSqlReceiptMethodConfig(req, methodKey) {
  const mk = normalizeToken(methodKey);
  const clientId = req?.client?.id || req?.client?.client_id || null;
  let values = {};
  if (clientId) {
    const [rows] = await pool.query(
      `SELECT values_json FROM client_integration
       WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider IN ('sql', 'sqlaccount') AND enabled = 1
       LIMIT 1`,
      [clientId]
    );
    if (rows.length) {
      const raw = rows[0].values_json;
      values = typeof raw === 'string' ? (parseJson(raw) || {}) : (raw || {});
    }
  }
  const byMethodPayment =
    mk === 'cash'
      ? String(values.sqlaccount_payment_method_code_cash || '').trim()
      : String(values.sqlaccount_payment_method_code_bank || '').trim();
  const byMethodReceipt =
    mk === 'cash'
      ? String(values.sqlaccount_receipt_account_code_cash || '').trim()
      : String(values.sqlaccount_receipt_account_code_bank || '').trim();
  const fallbackPayment = String(process.env.SQLACCOUNT_PAYMENT_METHOD_CODE || '').trim();
  const fallbackReceipt = String(process.env.SQLACCOUNT_RECEIPT_ACCOUNT_CODE || '').trim();
  return {
    paymentMethodCode: byMethodPayment || fallbackPayment,
    receiptAccountCode: byMethodReceipt || fallbackReceipt
  };
}

function buildXeroInvoiceOpenUrl(invoiceId) {
  const id = invoiceId != null ? String(invoiceId).trim() : '';
  if (!id) return null;
  return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(id)}`;
}

function isXeroInvalidPaymentAccountError(err) {
  const text = typeof err === 'string' ? err : JSON.stringify(err || {});
  return /account type is invalid for making a payment to\/from/i.test(text);
}

async function findXeroPaymentEnabledAccountCode(req, preferredCodes = []) {
  const listRes = await xeroAccount.list(req, {});
  if (!listRes?.ok) return '';
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const activeRows = rows.filter((a) => String(a?.Status || '').toUpperCase() === 'ACTIVE');
  // Xero Payments allows: BANK accounts OR non-bank accounts with EnablePaymentsToAccount=true.
  const payable = activeRows.filter((a) => {
    const code = String(a?.Code || '').trim();
    if (!code) return false;
    const type = String(a?.Type || '').toUpperCase();
    return type === 'BANK' || a?.EnablePaymentsToAccount === true;
  });
  const preferred = preferredCodes
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  for (const code of preferred) {
    if (payable.some((a) => String(a.Code || '').trim() === code)) return code;
  }
  const bankLike = payable.find((a) => String(a?.Type || '').toUpperCase() === 'BANK');
  if (bankLike?.Code) return String(bankLike.Code).trim();
  const any = payable[0];
  return any?.Code ? String(any.Code).trim() : '';
}

async function findXeroBankAccountCode(req, preferredCodes = []) {
  const listRes = await xeroAccount.list(req, {});
  if (!listRes?.ok) return '';
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const activeRows = rows.filter((a) => String(a?.Status || '').toUpperCase() === 'ACTIVE');
  const bankRows = activeRows.filter((a) => {
    const code = String(a?.Code || '').trim();
    const type = String(a?.Type || '').toUpperCase();
    return !!code && type === 'BANK';
  });
  const preferred = preferredCodes
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  for (const code of preferred) {
    if (bankRows.some((a) => String(a.Code || '').trim() === code)) return code;
  }
  return bankRows[0]?.Code ? String(bankRows[0].Code).trim() : '';
}

async function findXeroBankAccountRef(req, preferredKeys = []) {
  const listRes = await xeroAccount.list(req, {});
  if (!listRes?.ok) return null;
  const rows = Array.isArray(listRes.data?.Accounts) ? listRes.data.Accounts : [];
  const bankRows = rows.filter((a) => {
    const status = String(a?.Status || '').toUpperCase();
    const type = String(a?.Type || '').toUpperCase();
    return status === 'ACTIVE' && type === 'BANK';
  });
  if (!bankRows.length) return null;
  const norm = (v) => String(v || '').trim().toLowerCase();
  const preferred = preferredKeys.map(norm).filter(Boolean);
  const byKey = (a) => {
    const code = String(a?.Code || '').trim();
    if (code) return { Code: code };
    const id = String(a?.AccountID || a?.accountID || '').trim();
    return id ? { AccountID: id } : null;
  };
  for (const k of preferred) {
    const hit = bankRows.find((a) => {
      const code = norm(a?.Code);
      const id = norm(a?.AccountID || a?.accountID);
      return k === code || k === id;
    });
    if (hit) {
      const ref = byKey(hit);
      if (ref) return ref;
    }
  }
  const first = byKey(bankRows[0]);
  return first || null;
}

/** POST /Payments `Account`: Code when present; BANK accounts often have empty Code — use AccountID (matches Xero UI bank allocation). */
async function buildXeroPaymentAccountForReceipt(req, mappedAccountId) {
  const raw = mappedAccountId != null ? String(mappedAccountId).trim() : '';
  if (!raw) return null;
  const ref = await resolveXeroPaymentAccountRef(req, raw);
  if (!ref) return null;
  if (ref.AccountID) {
    return { AccountID: ref.AccountID };
  }
  const code = (await findXeroPaymentEnabledAccountCode(req, [ref.Code])) || ref.Code;
  return code ? { Code: code } : null;
}

/**
 * Resolve client's accounting: pricing plan + addonAccount integration. No email required.
 * @returns {Promise<{ ok: boolean, provider?: string, req?: object, reason?: string }>}
 */
async function resolveClientAccounting(clientId) {
  if (!clientId) return { ok: false, reason: 'NO_CLIENT_ID' };
  const [planRows] = await pool.query(
    `SELECT plan_id FROM client_pricingplan_detail WHERE client_id = ? AND type = 'plan' LIMIT 1`,
    [clientId]
  );
  const planId = planRows[0]?.plan_id;
  if (!planId || !ACCOUNTING_PLAN_IDS.includes(planId)) {
    return { ok: false, reason: 'ACCOUNTING_NOT_ALLOWED' };
  }
  // Prefer main Account over addonAccount; then most recently updated (avoids LIMIT 1 picking wrong provider when multiple rows exist).
  const [intRows] = await pool.query(
    `SELECT provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1
     ORDER BY CASE WHEN \`key\` = 'Account' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`,
    [clientId]
  );
  if (!intRows.length) return { ok: false, reason: 'NO_INTEGRATION' };
  const provider = (intRows[0].provider || '').toString().trim().toLowerCase();
  if (!['bukku', 'xero', 'autocount', 'sql'].includes(provider)) {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER', provider };
  }
  const values = parseJson(intRows[0].values_json) || {};
  const req = { client: { id: clientId } };
  if (provider === 'bukku') {
    req.client.bukku_secretKey = values.bukku_secretKey || values.bukku_token;
    req.client.bukku_subdomain = values.bukku_subdomain;
    if (!req.client.bukku_secretKey || !req.client.bukku_subdomain) {
      return { ok: false, reason: 'NO_BUKKU_CREDENTIALS' };
    }
  }
  if (provider === 'xero') {
    const token = values.xero_access_token ?? values.xero_secretKey ?? values.xero_token;
    const tenantId = values.xero_tenant_id ?? values.tenant_id ?? values.tenantId;
    if (!token || !tenantId) return { ok: false, reason: 'NO_XERO_CREDENTIALS' };
    req.client.xero_access_token = String(token).trim();
    req.client.xero_tenant_id = String(tenantId).trim();
  }
  return { ok: true, provider, req };
}

/**
 * Resolve account.id from account table by payment type (bank/cash/stripe/deposit/rental).
 * Matches account.title against PAYMENT_TYPE_TITLES; returns first matching row id.
 */
async function getAccountIdByPaymentType(method) {
  if (!method) return null;
  const key = (String(method)).toLowerCase();
  const titles = PAYMENT_TYPE_TITLES[key];
  if (!titles || !titles.length) return null;
  const placeholders = titles.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id FROM account WHERE TRIM(title) IN (${placeholders}) LIMIT 1`,
    titles
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Get payment/receipt destination account id in accounting system (e.g. Bukku account_id number).
 * Reads from table account (by title) → account_client or account_json for client + provider.
 * method: 'bank' | 'cash' | 'stripe' | 'deposit' | 'rental'.
 * @returns {Promise<{ accountId: string }|null>}
 */
async function getPaymentDestinationAccountId(clientId, provider, method) {
  if (!clientId || !provider || !method) return null;
  const key = String(method).toLowerCase();
  const titles = PAYMENT_TYPE_TITLES[key];
  if (!titles || !titles.length) return null;
  const placeholders = titles.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id FROM account WHERE TRIM(title) IN (${placeholders})`,
    titles
  );
  const accountTypeIds = (rows || []).map((r) => r.id).filter(Boolean);
  if (!accountTypeIds.length) return null;

  // If there are duplicate template rows (same title), prefer the one that has a mapping for this provider.
  for (const typeId of accountTypeIds) {
    const mapping = await getAccountMapping(clientId, typeId, provider);
    if (mapping && mapping.accountId) return { accountId: mapping.accountId };
  }
  return null;
}

/**
 * Load mapping from account_client or account_json; allows accountid and/or productId (either may be null).
 */
async function loadAccountClientMapping(clientId, typeId, provider) {
  if (!clientId || !typeId || !provider) return null;
  const [rows] = await pool.query(
    `SELECT accountid, product_id FROM account_client
     WHERE account_id = ? AND client_id = ? AND \`system\` = ? LIMIT 1`,
    [typeId, clientId, provider]
  );
  if (rows.length) {
    const accountId =
      rows[0].accountid != null && String(rows[0].accountid).trim() !== ''
        ? String(rows[0].accountid).trim()
        : null;
    const productId =
      rows[0].product_id != null && String(rows[0].product_id).trim() !== ''
        ? String(rows[0].product_id).trim()
        : null;
    if (accountId || productId) return { accountId, productId };
  }
  const [accRows] = await pool.query('SELECT account_json FROM account WHERE id = ? LIMIT 1', [typeId]);
  if (!accRows.length) return null;
  const arr = parseJson(accRows[0].account_json);
  const entry = Array.isArray(arr)
    ? arr.find(
        (a) =>
          (a.clientId === clientId || a.client_id === clientId) &&
          (a.system || '').toLowerCase() === provider
      )
    : null;
  if (!entry) return null;
  const accountId =
    entry.accountid != null && String(entry.accountid).trim() !== '' ? String(entry.accountid).trim() : null;
  const productId =
    entry.productId != null && String(entry.productId).trim() !== '' ? String(entry.productId).trim() : null;
  if (!accountId && !productId) return null;
  return { accountId, productId };
}

/**
 * Get account mapping for payment flows / expenses / reports: requires account id on the template row.
 * (Does not merge Platform Collection — use getAccountMappingForRentalIncomeLine for tenant invoice lines.)
 */
async function getAccountMapping(clientId, typeId, provider) {
  const line = await loadAccountClientMapping(clientId, typeId, provider);
  if (!line || !line.accountId) return null;
  return { accountId: line.accountId, productId: line.productId };
}

/**
 * Mapping for rentalcollection credit/cash invoice lines: Parking Fees, Rental Income, Topup Aircond, Other, Forfeit Deposit use
 * product_id from this template and account_id from Platform Collection. Remaining types use account_id + product_id on the same row.
 *
 * Owner Commission / Management Fees: operators often sync **product_id only** on the template (Bukku product) + Platform Collection GL — same as Rental Income.
 * Without this fallback, `accountid` empty → no mapping → no invoice.
 */
async function getAccountMappingForRentalIncomeLine(clientId, typeId, provider) {
  const line = await loadAccountClientMapping(clientId, typeId, provider);
  if (!line) return null;
  if (isIncomeLineUsesPlatformCollectionAccount(typeId)) {
    const pc = await loadAccountClientMapping(clientId, PLATFORM_COLLECTION_ACCOUNT_ID, provider);
    if (!pc || !pc.accountId) return null;
    if (!line.productId) return null;
    return { accountId: pc.accountId, productId: line.productId };
  }
  if (line.accountId) {
    return { accountId: line.accountId, productId: line.productId };
  }
  const tid = String(typeId || '').trim().toLowerCase();
  if (
    line.productId &&
    (tid === String(OWNER_COMMISSION_WIX_ID).trim().toLowerCase() || tid === MANAGEMENT_FEES_ACCOUNT_ID.toLowerCase())
  ) {
    const pc = await loadAccountClientMapping(clientId, PLATFORM_COLLECTION_ACCOUNT_ID, provider);
    if (!pc || !pc.accountId) return null;
    return { accountId: pc.accountId, productId: line.productId };
  }
  return null;
}

/**
 * Get contact for invoice: owner-commission + management fees → property owner; all others → tenant (credit or special cash).
 * Tenancy setting: extend/change room/terminate create rentalcollection; forfeit deposit is credit invoice to tenant.
 * Ensures contact exists (ensureContactInAccounting) and returns contactId.
 */
async function getContactForRentalItem(clientId, provider, req, { invoiceToOwner, propertyId, tenantId }) {
  if (invoiceToOwner) {
    if (!propertyId) {
      return { ok: false, reason: 'PROPERTY_ID_REQUIRED_FOR_OWNER_BILLING' };
    }
    const [propRows] = await pool.query(
      'SELECT owner_id FROM propertydetail WHERE id = ? AND client_id = ? LIMIT 1',
      [propertyId, clientId]
    );
    const ownerId = propRows[0]?.owner_id;
    if (!ownerId) return { ok: false, reason: 'PROPERTY_OWNER_NOT_FOUND' };
    const [ownerRows] = await pool.query(
      'SELECT id, ownername, email, mobilenumber FROM ownerdetail WHERE id = ? LIMIT 1',
      [ownerId]
    );
    if (!ownerRows.length) return { ok: false, reason: 'OWNER_NOT_FOUND' };
    const o = ownerRows[0];
    const [ownerAccRows] = await pool.query('SELECT account FROM ownerdetail WHERE id = ? LIMIT 1', [ownerId]);
    const existingAccount = parseJson(ownerAccRows[0]?.account);
    const existingId = Array.isArray(existingAccount) ? existingAccount.find((a) => a.clientId === clientId && a.provider === provider)?.id : null;
    const sync = await ensureContactInAccounting(clientId, provider, 'owner', {
      fullname: o.ownername,
      email: o.email,
      phone: o.mobilenumber
    }, existingId);
    if (!sync.ok) return sync;
    /** Cash sales invoice requires Bukku contact to include type `customer`; supplier-only owners fail with 422. */
    if (provider === 'bukku' && req) {
      const salesOk = await ensureBukkuContactHasCustomerTypeForSales(req, sync.contactId);
      if (!salesOk.ok) {
        return { ok: false, reason: salesOk.reason || 'BUKKU_OWNER_CONTACT_NEEDS_CUSTOMER_FOR_SALES' };
      }
    }
    await writeOwnerAccount(ownerId, clientId, provider, sync.contactId);
    return { ok: true, contactId: sync.contactId };
  }
  if (!tenantId) return { ok: false, reason: 'TENANT_ID_REQUIRED' };
  const [tenantRows] = await pool.query(
    'SELECT id, fullname, email, phone, account FROM tenantdetail WHERE id = ? LIMIT 1',
    [tenantId]
  );
  if (!tenantRows.length) return { ok: false, reason: 'TENANT_NOT_FOUND' };
  const t = tenantRows[0];
  const accountArr = parseJson(t.account);
  const existingId = Array.isArray(accountArr) ? accountArr.find((a) => a.clientId === clientId && a.provider === provider)?.id : null;
  const sync = await ensureContactInAccounting(clientId, provider, 'tenant', {
    fullname: t.fullname,
    email: t.email,
    phone: t.phone
  }, existingId);
  if (!sync.ok) return sync;
  await writeTenantAccount(tenantId, clientId, provider, sync.contactId);
  return { ok: true, contactId: sync.contactId };
}

/**
 * Create one credit invoice (due date = item date). Contact = owner for owner commission, else tenant.
 * Line item description: use opts.description (type title | room name | tenant name | date) when provided; else opts.title.
 * @returns {Promise<{ ok: boolean, invoiceId?: string, reason?: string }>}
 */
/** YYYY-MM-DD for invoice; invalid dates fall back to today (avoids RangeError on bad dueDate). */
function toInvoiceDateOnly(dueDate) {
  if (dueDate == null || dueDate === '') return getTodayMalaysiaDate();
  // rentalcollection.date is stored as UTC wall time (malaysiaDateToUtcDatetimeForDb). Parsing
  // "YYYY-MM-DD HH:mm:ss" with new Date() is local-time on the server and shifts the instant on
  // non-UTC hosts — always interpret SQL datetimes as UTC before MY calendar day.
  if (typeof dueDate === 'string') {
    const t = dueDate.trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(t)) {
      return utcDatetimeFromDbToMalaysiaDateOnly(t) || getTodayMalaysiaDate();
    }
  }
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return getTodayMalaysiaDate();
  return utcDatetimeFromDbToMalaysiaDateOnly(d);
}

async function createCreditInvoice(req, provider, opts) {
  const { contactId, accountId, productId, amount, dueDate, title, description } = opts || {};
  if (!contactId || !accountId || amount == null) {
    return { ok: false, reason: 'MISSING_CONTACT_OR_ACCOUNT_OR_AMOUNT' };
  }
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const desc = (description != null ? String(description) : (title || 'Rental')).trim().slice(0, 2000);
  const dateStr = toInvoiceDateOnly(dueDate);

  try {
    if (provider === 'bukku') {
      const cid = Number(contactId);
      const aid = Number(accountId);
      const currencyCode = await getClientCurrencyCode(req?.client?.id);
      if (!Number.isFinite(cid) || !Number.isFinite(aid)) {
        return { ok: false, reason: 'INVALID_CONTACT_OR_ACCOUNT_ID' };
      }
      const payload = {
        payment_mode: 'credit',
        contact_id: cid,
        date: dateStr,
        currency_code: currencyCode,
        exchange_rate: 1,
        tax_mode: 'exclusive',
        form_items: [{
          account_id: aid,
          description: desc,
          unit_price: amt,
          quantity: 1
        }],
        // Bukku: each term needs term_id OR date; payment_due is %/amount due, not the calendar date.
        term_items: [{ date: dateStr, payment_due: '100%', description: 'Due' }],
        status: 'ready'
      };
      if (productId != null && productId !== '') {
        const pid = Number(productId);
        if (Number.isFinite(pid)) payload.form_items[0].product_id = pid;
      }
      const myInvois = await resolveBukkuCreateInvoiceMyInvoisAction(req, contactId);
      if (myInvois.myinvois_action) payload.myinvois_action = myInvois.myinvois_action;
      logInvoiceFlow('bukku_credit_payload', {
        clientId: req?.client?.id ?? null,
        bukkuSubdomain: req?.client?.bukku_subdomain ? String(req.client.bukku_subdomain) : null,
        payment_mode: payload.payment_mode,
        contact_id: payload.contact_id,
        date: payload.date,
        form_items: payload.form_items,
        term_items: payload.term_items,
        status: payload.status,
        myinvois_action: payload.myinvois_action ?? null,
        myinvois_meta: myInvois.meta,
        hint:
          'myinvois_action set only when client_integration.einvoice=1 and contact is_myinvois_ready; else plain invoice. Raw HTTP: [bukku-api].'
      });
      const res = await bukkuInvoice.createinvoice(req, payload);
      const parsed = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(res);
      logInvoiceFlow('bukku_credit_response', {
        clientId: req?.client?.id ?? null,
        ok: !!parsed.invoiceId,
        invoiceId: parsed.invoiceId,
        shortLink: parsed.shortLink || null,
        documentNumber: parsed.documentNumber || null,
        bukkuWrapperOk: res?.ok,
        httpStatus: res?.status,
        reasonIfFailed: parsed.invoiceId ? null : formatProviderError(res?.error) || 'BUKKU_CREATE_FAILED',
        rawErrorForDebug: parsed.invoiceId ? undefined : res?.error
      });
      if (!parsed.invoiceId) return { ok: false, reason: formatProviderError(res?.error) || 'BUKKU_CREATE_FAILED' };
      const invoiceUrl =
        parsed.shortLink || (await getInvoiceUrl(req, provider, parsed.invoiceId));
      return {
        ok: true,
        invoiceId: parsed.invoiceId,
        invoiceUrl,
        accountingDocumentNumber: parsed.documentNumber || null
      };
    }

    if (provider === 'xero') {
      const accountCode = await resolveXeroAccountCode(req, accountId);
      if (!accountCode) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED' };
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
      const currencyCode = await getXeroInvoiceCurrencyForClientId(req?.client?.id);
      const payload = {
        Type: 'ACCREC',
        Contact,
        CurrencyCode: currencyCode,
        Date: dateStr,
        DueDate: dateStr,
        LineItems: [{
          Description: desc,
          Quantity: 1,
          UnitAmount: amt,
          AccountCode: accountCode
        }],
        Status: 'AUTHORISED'
      };
      const res = await xeroInvoice.create(req, payload);
      const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
      const id = inv?.InvoiceID ?? inv?.InvoiceId;
      if (!id) return { ok: false, reason: formatProviderError(res?.error) || 'XERO_CREATE_FAILED' };
      let invoiceNumber = inv?.InvoiceNumber != null && String(inv.InvoiceNumber).trim() !== ''
        ? String(inv.InvoiceNumber).trim()
        : null;
      if (!invoiceNumber) {
        const readRes = await xeroInvoice.read(req, id);
        const inv2 = readRes?.data?.Invoices?.[0] ?? readRes?.Invoices?.[0];
        invoiceNumber = inv2?.InvoiceNumber != null && String(inv2.InvoiceNumber).trim() !== ''
          ? String(inv2.InvoiceNumber).trim()
          : null;
      }
      return { ok: true, invoiceId: id, accountingDocumentNumber: invoiceNumber };
    }

    if (provider === 'autocount') {
      const payload = {
        master: {
          docDate: dateStr,
          debtorCode: String(contactId),
          debtorName: desc
        },
        details: [{
          productCode: productId && String(productId) ? String(productId) : 'GENERAL',
          description: desc,
          qty: 1,
          unitPrice: amt
        }]
      };
      const res = await autocountInvoice.createInvoice(req, payload);
      const docNo = res?.data?.docNo ?? res?.data?.DocNo ?? res?.docNo;
      if (!docNo) return { ok: false, reason: formatProviderError(res?.error) || 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, invoiceId: String(docNo) };
    }

    if (provider === 'sql') {
      const payload = {
        contactId: String(contactId),
        accountId: String(accountId),
        amount: amt,
        description: desc,
        date: dateStr
      };
      const res = await sqlInvoice.createInvoice(req, payload);
      const id =
        res?.data?.id ??
        res?.data?.Id ??
        res?.data?.dockey ??
        res?.data?.DocKey ??
        res?.id ??
        res?.data?.DocNo ??
        res?.data?.docNo;
      const docNo =
        res?.data?.DocNo ??
        res?.data?.docNo ??
        res?.data?.DocumentNo ??
        res?.data?.documentNo ??
        null;
      if (!id) return { ok: false, reason: formatProviderError(res?.error) || 'SQL_CREATE_FAILED' };
      return {
        ok: true,
        invoiceId: String(id),
        accountingDocumentNumber: docNo != null && String(docNo).trim() !== '' ? String(docNo).trim() : null
      };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'CREATE_INVOICE_FAILED' };
  }
}

/**
 * Get invoice URL for payment tracking. Xero: GET OnlineInvoice; Bukku: build from subdomain; AutoCount/SQL: null.
 */
async function getInvoiceUrl(req, provider, invoiceId) {
  if (!invoiceId) return null;
  try {
    if (provider === 'xero') {
      // Xero may take a short time to materialize OnlineInvoice link right after create.
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await xeroInvoice.getOnlineInvoiceUrl(req, invoiceId);
        if (res.ok && res.url) return res.url;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
      }
      // Fallback to Xero app invoice page so operator always has an openable link.
      return buildXeroInvoiceOpenUrl(invoiceId);
    }
    if (provider === 'bukku' && req.client?.bukku_subdomain) {
      const sub = String(req.client.bukku_subdomain).trim();
      return `https://${sub}.bukku.my/invoices/${invoiceId}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if type_id is owner commission (for contact = owner).
 */
async function isOwnerCommissionType(typeId) {
  if (!typeId) return false;
  return String(typeId).trim() === String(OWNER_COMMISSION_WIX_ID).trim();
}

/**
 * Owner billing line types (invoice to property owner): Owner Commission + Management Fees.
 * Previously implemented as Bukku cash sales; now credit invoice + receipt to Platform Collection (same substance).
 */
async function isCashInvoiceToPropertyOwner(typeId) {
  if (!typeId) return false;
  if (String(typeId).trim() === MANAGEMENT_FEES_ACCOUNT_ID) return true;
  return isOwnerCommissionType(typeId);
}

/**
 * Legacy name: value is the canonical account row id for Owner Commission (same as old Wix _id).
 */
async function getAccountIdByWixId(wixId) {
  if (!wixId) return null;
  const [rows] = await pool.query('SELECT id FROM account WHERE id = ? LIMIT 1', [wixId]);
  return rows[0] ? rows[0].id : null;
}

/**
 * Top-up / meter cash invoice line type: prefer seed id, else match by title.
 */
async function resolveTopupAircondAccountId() {
  const [byId] = await pool.query('SELECT id FROM account WHERE id = ? LIMIT 1', [TOPUP_AIRCOND_ACCOUNT_ID]);
  if (byId.length) return byId[0].id;
  const titles = ['Topup Aircond', 'Top-up Aircond', 'Meter Topup', 'topup aircond', 'Meter top-up'];
  const ph = titles.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id FROM account WHERE TRIM(title) IN (${ph}) ORDER BY title ASC LIMIT 1`,
    titles
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Subdomain for building public Bukku invoice/payment links (tenant portal / operator invoice list).
 */
async function getBukkuSubdomainForClientInvoiceLink(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND enabled = 1 AND provider = 'bukku'
     ORDER BY \`key\` ASC`,
    [clientId]
  );
  for (const row of rows) {
    const v = parseJson(row.values_json) || {};
    const sub = v.bukku_subdomain ?? v.bukkuSubdomain ?? v.subdomain;
    if (sub && String(sub).trim()) return String(sub).trim();
  }
  return null;
}

function buildRentalInvoiceDisplayUrl(invoiceurl, invoiceid, bukkuSub) {
  const u = invoiceurl != null ? String(invoiceurl).trim() : '';
  if (u && /^https?:\/\//i.test(u)) return u;
  const id = invoiceid != null && String(invoiceid).trim() !== '' ? String(invoiceid).trim() : '';
  const sub = bukkuSub != null && String(bukkuSub).trim() !== '' ? String(bukkuSub).trim() : '';
  if (id && sub) return `https://${sub}.bukku.my/invoices/${id}`.replace(/\/+/g, '/');
  return u || null;
}

/** Bukku sales payment id → public payment page (best-effort; receipturl often stores short_link already). */
function buildRentalReceiptDisplayUrl(receipturl, payId, bukkuSub) {
  const u = receipturl != null ? String(receipturl).trim() : '';
  if (u && /^https?:\/\//i.test(u)) return u;
  const id = payId != null && String(payId).trim() !== '' ? String(payId).trim() : '';
  const sub = bukkuSub != null && String(bukkuSub).trim() !== '' ? String(bukkuSub).trim() : '';
  if (id && sub) return `https://${sub}.bukku.my/payments/${id}`.replace(/\/+/g, '/');
  return u || null;
}

function parseAccountingReceiptSnapshotJson(raw) {
  if (raw == null || raw === '') return null;
  const o = parseJson(raw);
  if (!o || typeof o !== 'object') return null;
  return o;
}

function formatAccountingInvoiceReceiptLabel(invoiceDocNum, receiptNo) {
  const inv = invoiceDocNum != null && String(invoiceDocNum).trim() ? String(invoiceDocNum).trim() : '';
  const rec = receiptNo != null && String(receiptNo).trim() ? String(receiptNo).trim() : '';
  if (inv && rec) return `${inv} | ${rec}`;
  return inv || rec || '';
}

/**
 * Build invoice line item description: type title | room name | tenant name | date (payment/due).
 * One rentalcollection or one metertransaction = one invoice with one line; all four account systems support item description.
 * @param {{ type_id?: string, tenant_id?: string, room_id?: string, tenancy_id?: string, date?: string|Date }} record
 * @returns {Promise<string>} description string, max 255 chars
 */
async function buildInvoiceDescription(record) {
  let typeTitle = '';
  let roomName = '';
  let tenantName = '';
  let dateStr = '';

  if (record.type_id) {
    const [a] = await pool.query('SELECT title FROM account WHERE id = ? LIMIT 1', [record.type_id]);
    typeTitle = (a[0] && a[0].title) ? String(a[0].title).trim() : '';
  }
  if (record.tenant_id) {
    const [t] = await pool.query('SELECT fullname FROM tenantdetail WHERE id = ? LIMIT 1', [record.tenant_id]);
    tenantName = (t[0] && t[0].fullname) ? String(t[0].fullname).trim() : '';
  }
  let roomId = record.room_id;
  if (!roomId && record.tenancy_id) {
    const [tn] = await pool.query('SELECT room_id FROM tenancy WHERE id = ? LIMIT 1', [record.tenancy_id]);
    roomId = tn[0] && tn[0].room_id ? tn[0].room_id : null;
  }
  if (roomId) {
    const [r] = await pool.query('SELECT title_fld, roomname FROM roomdetail WHERE id = ? LIMIT 1', [roomId]);
    roomName = (r[0] && (r[0].title_fld || r[0].roomname)) ? String(r[0].title_fld || r[0].roomname).trim() : '';
  }
  if (record.date) {
    if (typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(record.date.trim())) {
      dateStr = utcDatetimeFromDbToMalaysiaDateOnly(record.date.trim()) || '';
    } else {
      const d = record.date instanceof Date ? record.date : new Date(record.date);
      dateStr = d.toISOString ? utcDatetimeFromDbToMalaysiaDateOnly(d) : String(record.date).slice(0, 10);
    }
  }

  const lines = [typeTitle, roomName, tenantName, dateStr].filter(Boolean);
  const desc = lines.join('\n') || 'Invoice item';
  return desc.slice(0, 2000);
}

/**
 * Create one cash invoice (payment already received). Used for meter topup after Stripe webhook; generate report management fee.
 * When opts.paymentAccountId is set, use it for deposit_items (payment destination); else use accountId.
 * When opts.date is set, use for invoice date; else today.
 * Line item description: use opts.description (type title | room name | tenant name | date) when provided; else opts.title.
 * @returns {Promise<{ ok: boolean, invoiceId?: string, reason?: string }>}
 */
async function createCashInvoice(req, provider, opts) {
  const { contactId, accountId, productId, amount, title, description, paymentAccountId, date } = opts || {};
  if (!contactId || !accountId || amount == null) {
    return { ok: false, reason: 'MISSING_CONTACT_OR_ACCOUNT_OR_AMOUNT' };
  }
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const desc = (description != null ? String(description) : (title || 'Meter Top-up')).trim().slice(0, 2000);
  let dateStr = getTodayMalaysiaDate();
  if (date != null) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(date.trim())) {
      dateStr = utcDatetimeFromDbToMalaysiaDateOnly(date.trim()) || getTodayMalaysiaDate();
    } else {
      const dateVal = date instanceof Date ? date : new Date(date);
      if (dateVal && dateVal.toISOString && !Number.isNaN(dateVal.getTime())) {
        dateStr = utcDatetimeFromDbToMalaysiaDateOnly(dateVal) || getTodayMalaysiaDate();
      }
    }
  }
  const depositAccountId = paymentAccountId != null && String(paymentAccountId).trim() !== '' ? Number(paymentAccountId) : Number(accountId);

  try {
    if (provider === 'bukku') {
      const cid = Number(contactId);
      const lineAid = Number(accountId);
      const depAid = Number(depositAccountId);
      const currencyCode = await getClientCurrencyCode(req?.client?.id);
      if (!Number.isFinite(cid) || !Number.isFinite(lineAid) || !Number.isFinite(depAid)) {
        return { ok: false, reason: 'INVALID_CONTACT_OR_ACCOUNT_ID' };
      }
      const payload = {
        payment_mode: 'cash',
        contact_id: cid,
        date: dateStr,
        currency_code: currencyCode,
        exchange_rate: 1,
        tax_mode: 'exclusive',
        form_items: [{ account_id: lineAid, description: desc, unit_price: amt, quantity: 1 }],
        deposit_items: [{ account_id: depAid, amount: amt }],
        status: 'ready'
      };
      if (productId != null && productId !== '') {
        const pid = Number(productId);
        if (Number.isFinite(pid)) payload.form_items[0].product_id = pid;
      }
      const myInvoisCash = await resolveBukkuCreateInvoiceMyInvoisAction(req, contactId);
      if (myInvoisCash.myinvois_action) payload.myinvois_action = myInvoisCash.myinvois_action;
      logInvoiceFlow('bukku_cash_payload', {
        clientId: req?.client?.id ?? null,
        contact_id: payload.contact_id,
        myinvois_action: payload.myinvois_action ?? null,
        myinvois_meta: myInvoisCash.meta
      });
      const res = await bukkuInvoice.createinvoice(req, payload);
      const parsed = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(res);
      if (!parsed.invoiceId) return { ok: false, reason: formatProviderError(res?.error) || 'BUKKU_CREATE_FAILED' };
      const invoiceUrl =
        parsed.shortLink || (await getInvoiceUrl(req, provider, parsed.invoiceId));
      return {
        ok: true,
        invoiceId: parsed.invoiceId,
        invoiceUrl,
        accountingDocumentNumber: parsed.documentNumber || null
      };
    }

    if (provider === 'xero') {
      const lineAccount = await resolveXeroInvoiceLineItemAccount(req, accountId);
      if (!lineAccount) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED' };
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
      const currencyCode = await getXeroInvoiceCurrencyForClientId(req?.client?.id);
      const payload = {
        Type: 'ACCREC',
        Contact,
        CurrencyCode: currencyCode,
        Date: dateStr,
        DueDate: dateStr,
        LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, ...lineAccount }],
        Status: 'AUTHORISED'
      };
      const res = await xeroInvoice.create(req, payload);
      const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
      const id = inv?.InvoiceID ?? inv?.InvoiceId;
      if (!id) return { ok: false, reason: formatProviderError(res?.error) || 'XERO_CREATE_FAILED' };
      let invoiceNumber = inv?.InvoiceNumber != null && String(inv.InvoiceNumber).trim() !== ''
        ? String(inv.InvoiceNumber).trim()
        : null;
      if (!invoiceNumber) {
        const readRes = await xeroInvoice.read(req, id);
        const inv2 = readRes?.data?.Invoices?.[0] ?? readRes?.Invoices?.[0];
        invoiceNumber = inv2?.InvoiceNumber != null && String(inv2.InvoiceNumber).trim() !== ''
          ? String(inv2.InvoiceNumber).trim()
          : null;
      }
      let payAccount = paymentAccountId ? await buildXeroPaymentAccountForReceipt(req, paymentAccountId) : null;
      if (!payAccount) {
        const bankCode = String(process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
        if (bankCode) {
          const c = await findXeroPaymentEnabledAccountCode(req, [bankCode]) || bankCode;
          if (c) payAccount = { Code: c };
        }
      }
      if (payAccount) {
        const payRes = await xeroPayment.createPayment(req, {
          Invoice: { InvoiceID: id },
          Account: payAccount,
          Date: dateStr,
          Amount: amt,
          Reference: 'Meter top-up'
        });
        if (!payRes?.ok) {
          const reason = formatProviderError(payRes?.error);
          return { ok: false, reason: reason || 'XERO_PAYMENT_FAILED' };
        }
      }
      return { ok: true, invoiceId: id, accountingDocumentNumber: invoiceNumber };
    }

    if (provider === 'autocount') {
      const payload = {
        master: { docDate: dateStr, debtorCode: String(contactId), debtorName: desc },
        details: [{ productCode: (productId && String(productId)) || 'GENERAL', description: desc, qty: 1, unitPrice: amt }]
      };
      const res = await autocountInvoice.createInvoice(req, payload);
      const docNo = res?.data?.docNo ?? res?.data?.DocNo ?? res?.docNo;
      if (!docNo) return { ok: false, reason: formatProviderError(res?.error) || 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, invoiceId: String(docNo) };
    }

    if (provider === 'sql') {
      const payload = { contactId: String(contactId), accountId: String(accountId), amount: amt, description: desc, date: dateStr };
      const res = await sqlInvoice.createInvoice(req, payload);
      const id =
        res?.data?.id ??
        res?.data?.Id ??
        res?.data?.dockey ??
        res?.data?.DocKey ??
        res?.id ??
        res?.data?.DocNo ??
        res?.data?.docNo;
      const docNo =
        res?.data?.DocNo ??
        res?.data?.docNo ??
        res?.data?.DocumentNo ??
        res?.data?.documentNo ??
        null;
      if (!id) return { ok: false, reason: formatProviderError(res?.error) || 'SQL_CREATE_FAILED' };
      return {
        ok: true,
        invoiceId: String(id),
        accountingDocumentNumber: docNo != null && String(docNo).trim() !== '' ? String(docNo).trim() : null
      };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'CREATE_CASH_INVOICE_FAILED' };
  }
}

/**
 * CNYIoT recharge for tenant meter payment: amountRm (RM) → kWh by rate; only prepay; if balance negative, split (clear first then remainder).
 * Uses meterdetail.rate and meterdetail.meterid for API. Does not use meter_txid.
 */
async function doCnyIotRechargeForTenantMeter(clientId, tenancyId, amountRm) {
  if (!clientId || !tenancyId || amountRm <= 0) return { ok: false, reason: 'MISSING_PARAMS' };
  const [tRows] = await pool.query('SELECT room_id FROM tenancy WHERE id = ? AND client_id = ? LIMIT 1', [tenancyId, clientId]);
  if (!tRows.length || !tRows[0].room_id) return { ok: false, reason: 'NO_ROOM' };
  const roomId = tRows[0].room_id;
  const [mRows] = await pool.query(
    'SELECT m.id, m.rate, m.mode, m.meterid FROM roomdetail r INNER JOIN meterdetail m ON m.id = r.meter_id WHERE r.id = ? AND r.client_id = ? LIMIT 1',
    [roomId, clientId]
  );
  if (!mRows.length) return { ok: false, reason: 'NO_METER' };
  const meter = mRows[0];
  const mode = (meter.mode || 'prepaid').toString().toLowerCase();
  if (mode === 'postpaid') return { ok: false, reason: 'METER_POSTPAID_NO_TOPUP' };
  const platformMeterId = meter.meterid ? String(meter.meterid).trim() : '';
  if (!platformMeterId) return { ok: false, reason: 'NO_METER_ID' };
  const rate = Number(meter.rate) || 1;
  const amountKwh = amountRm / rate;
  if (amountKwh <= 0) return { ok: true, recharged: 0 };

  const meterWrapper = require('../cnyiot/wrappers/meter.wrapper');
  let balance = 0;
  try {
    const statusRes = await meterWrapper.getMeterStatus(clientId, platformMeterId);
    const d = statusRes?.value ?? statusRes;
    if (d && (d.pim === 0 || d.pim === 1)) {
      balance = Number(d.pim === 0 ? (d.e ?? d.s_enablekwh ?? 0) : (d.em ?? d.s_enablekwh ?? 0)) || 0;
    } else {
      balance = Number(d?.s_enablekwh ?? d?.e ?? d?.em ?? 0) || 0;
    }
  } catch (e) {
    console.warn('[doCnyIotRecharge] getMeterStatus failed', e?.message || e);
  }

  const runOneRecharge = async (kwh) => {
    if (kwh <= 0) return;
    const pending = await meterWrapper.createPendingTopup(clientId, String(platformMeterId), kwh);
    const idx = pending?.value?.idx ?? pending?.idx;
    if (idx == null) throw new Error('TOPUP_PENDING_NO_IDX');
    await meterWrapper.confirmTopup(clientId, String(platformMeterId), idx);
  };

  if (balance < 0) {
    const firstKwh = Math.min(amountKwh, Math.abs(balance));
    await runOneRecharge(firstKwh);
    const remainderKwh = amountKwh - firstKwh;
    if (remainderKwh > 0) await runOneRecharge(remainderKwh);
  } else {
    await runOneRecharge(amountKwh);
  }
  return { ok: true, recharged: amountKwh };
}

/**
 * Called from Stripe webhook when checkout.session.completed and metadata.type === 'TenantMeter'.
 * Tenant dashboard #buttontopupmeter writes to metertransaction at create-payment (pending); we update that row to paid and create cash invoice.
 * Also runs CNYIoT recharge (prepay only, rate, negative balance split).
 * @param {{ metadata: object, amount_total: number, id: string, payment_intent?: string }} session - Stripe Checkout Session
 * @param {{ priorMarkedRows?: number }} [options]
 * @returns {Promise<{ ok: boolean, meterTransactionId?: string, invoiceId?: string, reason?: string, skipped?: string }>}
 */
async function handleTenantMeterPaymentSuccess(session, options = {}) {
  const priorMarkedRows = options.priorMarkedRows;
  const meterTransactionId = session.metadata?.meter_transaction_id;
  const tenancyId = session.metadata?.tenancy_id;
  const tenantId = session.metadata?.tenant_id;
  const amountCents = session.metadata?.amount_cents != null ? parseInt(String(session.metadata.amount_cents), 10) : NaN;
  const amount = Number.isFinite(amountCents) ? amountCents / 100 : (session.amount_total != null ? session.amount_total / 100 : 0);
  const piRaw = session.payment_intent;
  const piId =
    piRaw == null || piRaw === ''
      ? ''
      : typeof piRaw === 'string'
        ? piRaw.trim()
        : typeof piRaw === 'object' && piRaw.id
          ? String(piRaw.id).trim()
          : '';
  const referenceId = piId || String(session.id || '').trim();

  if (!meterTransactionId) {
    return { ok: false, reason: 'MISSING_METER_TRANSACTION_ID' };
  }
  if (!tenancyId || !tenantId || amount <= 0) {
    return { ok: false, reason: 'MISSING_TENANCY_OR_TENANT_OR_AMOUNT' };
  }

  const [mtRows] = await pool.query(
    'SELECT id, tenant_id, tenancy_id, property_id, amount, ispaid, status FROM metertransaction WHERE id = ? LIMIT 1',
    [meterTransactionId]
  );
  if (!mtRows.length) {
    return { ok: false, reason: 'METER_TRANSACTION_NOT_FOUND' };
  }
  const mt = mtRows[0];
  if (priorMarkedRows === 0 && Number(mt.ispaid) === 1) {
    return { ok: true, meterTransactionId, skipped: 'duplicate_delivery' };
  }
  let clientId = null;
  if (tenancyId) {
    const [tRows] = await pool.query('SELECT client_id FROM tenancy WHERE id = ? LIMIT 1', [tenancyId]);
    clientId = tRows[0] ? tRows[0].client_id : null;
  }
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await pool.query(
    `UPDATE metertransaction SET ispaid = 1, status = 'success', referenceid = ?, updated_at = ? WHERE id = ?`,
    [referenceId, now, meterTransactionId]
  );

  const amountRm = Number(mt.amount) || amount;
  if (clientId && amountRm > 0) {
    try {
      await doCnyIotRechargeForTenantMeter(clientId, tenancyId, amountRm);
    } catch (err) {
      console.warn('[handleTenantMeterPaymentSuccess] CNYIoT recharge failed', err?.message || err);
    }
  }

  const typeId = await resolveTopupAircondAccountId();
  const propertyId = mt.property_id || null;
  if (clientId && typeId) {
    const resolved = await resolveClientAccounting(clientId);
    if (resolved.ok && resolved.req) {
      const { provider, req } = resolved;
      const mapping = await getAccountMappingForRentalIncomeLine(clientId, typeId, provider);
      const stripeDest = await getPaymentDestinationAccountId(clientId, provider, 'stripe');
      if (mapping && mapping.accountId) {
        const contactRes = await getContactForRentalItem(clientId, provider, req, {
          invoiceToOwner: false,
          propertyId,
          tenantId
        });
        if (contactRes.ok) {
          const itemDescription = await buildInvoiceDescription({
            type_id: typeId,
            tenant_id: tenantId,
            tenancy_id: tenancyId,
            date: now
          });
          const cashRes = await createCashInvoice(req, provider, {
            contactId: contactRes.contactId,
            accountId: mapping.accountId,
            productId: mapping.productId,
            amount,
            description: itemDescription,
            /** Cash invoice: money lands in Stripe clearing (not the same as revenue line account). */
            paymentAccountId: stripeDest?.accountId
          });
          if (cashRes.ok) {
            const invoiceUrl =
              cashRes.invoiceUrl != null ? cashRes.invoiceUrl : await getInvoiceUrl(req, provider, cashRes.invoiceId);
            const mtDoc = cashRes.accountingDocumentNumber;
            if (mtDoc) {
              await pool.query(
                'UPDATE metertransaction SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ?, accounting_document_number = ? WHERE id = ?',
                [cashRes.invoiceId, invoiceUrl || null, cashRes.invoiceId, mtDoc, meterTransactionId]
              );
            } else {
              await pool.query(
                'UPDATE metertransaction SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ? WHERE id = ?',
                [cashRes.invoiceId, invoiceUrl || null, cashRes.invoiceId, meterTransactionId]
              );
            }
            return { ok: true, meterTransactionId, invoiceId: cashRes.invoiceId };
          }
        }
      }
    }
  }

  return { ok: true, meterTransactionId };
}

/**
 * After rentalcollection rows are inserted: create invoice per row (when client has accounting),
 * then update rentalcollection.invoiceid and rentalcollection.invoiceurl.
 * Each record must have: id, client_id, property_id, tenant_id, type_id, amount, date, title.
 * @param {string} clientId
 * @param {Array<{ id: string, client_id: string, property_id?: string, tenant_id: string, type_id: string, amount: number, date: string, title: string }>} records
 * @returns {Promise<{ ok: boolean, created: number, errors?: string[] }>}
 */
async function createInvoicesForRentalRecords(clientId, records) {
  if (!clientId || !Array.isArray(records) || !records.length) {
    return { ok: true, created: 0 };
  }
  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    logInvoiceFlow('create_invoices_skip', {
      clientId,
      reason: resolved.reason || 'no_integration_or_plan',
      hasReq: !!resolved.req
    });
    return { ok: true, created: 0 };
  }
  const { provider, req } = resolved;
  logInvoiceFlow('create_invoices_start', {
    clientId,
    provider,
    recordCount: records.length,
    rentalcollectionIds: records.map((x) => x.id)
  });
  let created = 0;
  const errors = [];
  for (const r of records) {
    const mapping = await getAccountMappingForRentalIncomeLine(clientId, r.type_id, provider);
    if (!mapping || !mapping.accountId) {
      logInvoiceFlow('row_skip_no_mapping', {
        clientId,
        rentalcollectionId: r.id,
        type_id: r.type_id,
        provider
      });
      errors.push(
        `No account mapping for type ${r.type_id} (for Parking/Rental Income/Topup set Product ID here and Account ID on Platform Collection)`
      );
      continue;
    }
    const invoiceToOwner = await isCashInvoiceToPropertyOwner(r.type_id);
    const contactRes = await getContactForRentalItem(clientId, provider, req, {
      invoiceToOwner,
      propertyId: r.property_id,
      tenantId: r.tenant_id
    });
    if (!contactRes.ok) {
      logInvoiceFlow('row_skip_contact', {
        clientId,
        rentalcollectionId: r.id,
        type_id: r.type_id,
        reason: contactRes.reason
      });
      errors.push(`Contact for ${r.id}: ${contactRes.reason}`);
      continue;
    }
    const itemDescription = await buildInvoiceDescription({
      type_id: r.type_id,
      tenant_id: r.tenant_id,
      room_id: r.room_id,
      tenancy_id: r.tenancy_id,
      date: r.date
    });
    logInvoiceFlow('row_before_invoice_create', {
      clientId,
      provider,
      rentalcollectionId: r.id,
      type_id: r.type_id,
      amount: r.amount,
      date: r.date,
      tenancy_id: r.tenancy_id,
      tenant_id: r.tenant_id,
      property_id: r.property_id,
      room_id: r.room_id,
      mappingAccountId: mapping.accountId,
      mappingProductId: mapping.productId ?? null,
      contactId: contactRes.contactId,
      invoiceToOwner,
      descriptionPreview: String(itemDescription || '').slice(0, 200)
    });
    const isForfeitDeposit = String(r.type_id || '').trim() === String(FORFEIT_DEPOSIT_ACCOUNT_ID);
    let invRes;
    if (invoiceToOwner) {
      /**
       * Owner commission + management fees: credit sales invoice, then payment to Platform Collection (same GL as former cash invoice).
       * Row is marked paid immediately; createReceiptForPaidRentalCollection records the receipt in Bukku/Xero/AutoCount/SQL.
       */
      invRes = await createCreditInvoice(req, provider, {
        contactId: contactRes.contactId,
        accountId: mapping.accountId,
        productId: mapping.productId,
        amount: r.amount,
        dueDate: r.date,
        description: itemDescription
      });
      if (!invRes.ok) {
        logInvoiceFlow('row_invoice_create_failed', {
          clientId,
          rentalcollectionId: r.id,
          provider,
          reason: formatProviderError(invRes.reason) || 'unknown'
        });
        errors.push(`Invoice for ${r.id}: ${formatProviderError(invRes.reason) || 'unknown'}`);
        continue;
      }
      const invoiceUrl =
        invRes.invoiceUrl != null ? invRes.invoiceUrl : await getInvoiceUrl(req, provider, invRes.invoiceId);
      const docNo = invRes.accountingDocumentNumber;
      const refOwnerSettled = 'Owner billing (credit + PC)';
      if (docNo) {
        await pool.query(
          `UPDATE rentalcollection
           SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ?, accounting_document_number = ?,
               ispaid = 1, paidat = ?,
               referenceid = IF(NULLIF(TRIM(COALESCE(referenceid, '')), '') = '', ?, referenceid),
               updated_at = NOW()
           WHERE id = ?`,
          [invRes.invoiceId, invoiceUrl || null, invRes.invoiceId, docNo, r.date, refOwnerSettled, r.id]
        );
      } else {
        await pool.query(
          `UPDATE rentalcollection
           SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ?,
               ispaid = 1, paidat = ?,
               referenceid = IF(NULLIF(TRIM(COALESCE(referenceid, '')), '') = '', ?, referenceid),
               updated_at = NOW()
           WHERE id = ?`,
          [invRes.invoiceId, invoiceUrl || null, invRes.invoiceId, r.date, refOwnerSettled, r.id]
        );
      }
      const recRes = await createReceiptForPaidRentalCollection([r.id], { source: 'manual', method: 'Bank' });
      if (recRes.errors?.length) {
        for (const msg of recRes.errors) {
          errors.push(`Receipt for owner line ${r.id}: ${msg}`);
        }
        logInvoiceFlow('row_owner_receipt_failed', {
          clientId,
          rentalcollectionId: r.id,
          errors: recRes.errors
        });
      }
      logInvoiceFlow('row_ok', {
        clientId,
        rentalcollectionId: r.id,
        provider,
        invoiceId: invRes.invoiceId,
        invoiceUrl: invoiceUrl || null,
        ownerBilling: 'credit_plus_receipt'
      });
      created++;
      continue;
    } else if (isForfeitDeposit) {
      /**
       * Forfeit deposit: cash invoice — form line = Platform Collection + Forfeit product (see mapping rules);
       * deposit_items = Deposit liability. Substance: DR Deposit, CR Platform Collection.
       */
      const depositDest = await getPaymentDestinationAccountId(clientId, provider, 'deposit');
      invRes = await createCashInvoice(req, provider, {
        contactId: contactRes.contactId,
        accountId: mapping.accountId,
        productId: mapping.productId,
        amount: r.amount,
        description: itemDescription,
        date: r.date,
        paymentAccountId: depositDest?.accountId
      });
    } else {
      invRes = await createCreditInvoice(req, provider, {
        contactId: contactRes.contactId,
        accountId: mapping.accountId,
        productId: mapping.productId,
        amount: r.amount,
        dueDate: r.date,
        description: itemDescription
      });
    }
    if (!invRes.ok) {
      logInvoiceFlow('row_invoice_create_failed', {
        clientId,
        rentalcollectionId: r.id,
        provider,
        reason: formatProviderError(invRes.reason) || 'unknown'
      });
      errors.push(`Invoice for ${r.id}: ${formatProviderError(invRes.reason) || 'unknown'}`);
      continue;
    }
    const invoiceUrl =
      invRes.invoiceUrl != null ? invRes.invoiceUrl : await getInvoiceUrl(req, provider, invRes.invoiceId);
    const docNo = invRes.accountingDocumentNumber;
    if (docNo) {
      await pool.query(
        `UPDATE rentalcollection SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ?, accounting_document_number = ? WHERE id = ?`,
        [invRes.invoiceId, invoiceUrl || null, invRes.invoiceId, docNo, r.id]
      );
    } else {
      await pool.query(
        `UPDATE rentalcollection SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ? WHERE id = ?`,
        [invRes.invoiceId, invoiceUrl || null, invRes.invoiceId, r.id]
      );
    }
    logInvoiceFlow('row_ok', {
      clientId,
      rentalcollectionId: r.id,
      provider,
      invoiceId: invRes.invoiceId,
      invoiceUrl: invoiceUrl || null
    });
    created++;
  }
  logInvoiceFlow('create_invoices_done', {
    clientId,
    provider,
    created,
    errorCount: errors.length,
    errors: errors.length ? errors : undefined
  });
  return { ok: true, created, errors: errors.length ? errors : undefined };
}

/**
 * Void invoices in the accounting system for given rentalcollection rows (e.g. before deleting
 * those rows in tenancy terminate / change room / cancel booking). Only unpaid rows (ispaid = 0)
 * with invoiceid or bukku_invoice_id are sent to the provider; client must have accounting integration.
 * All four systems use void (no delete). Failures are logged but do not throw.
 * @param {string} clientId
 * @param {string[]} rentalCollectionIds - rentalcollection.id list
 * @param {{ includePaid?: boolean, einvoiceCancelReason?: string }} [opts] - MyInvois cancel reason (default "change tenancy"); Bukku skips cancel if invoice has no e-invoice.
 * @returns {Promise<{ voided: number, errors: string[], fatalErrors: string[] }>}
 */
async function markRentalcollectionAccountingInvoiceVoided(clientId, rentalCollectionId) {
  if (!clientId || !rentalCollectionId) return;
  await pool.query(
    `UPDATE rentalcollection
     SET accounting_invoice_voided = 1, updated_at = NOW()
     WHERE client_id = ? AND id = ? AND COALESCE(accounting_invoice_voided, 0) = 0`,
    [clientId, rentalCollectionId]
  );
}

async function voidOrDeleteInvoicesForRentalCollectionIds(clientId, rentalCollectionIds, opts = {}) {
  const result = { voided: 0, errors: [], fatalErrors: [] };
  if (!clientId || !Array.isArray(rentalCollectionIds) || rentalCollectionIds.length === 0) {
    return result;
  }
  const includePaid = !!opts.includePaid;
  const placeholders = rentalCollectionIds.map(() => '?').join(',');
  const paidFilterSql = includePaid ? '' : 'AND ispaid = 0';
  const [rows] = await pool.query(
    `SELECT id,
            COALESCE(
              NULLIF(TRIM(COALESCE(invoiceid, '')), ''),
              NULLIF(TRIM(COALESCE(bukku_invoice_id, '')), '')
            ) AS resolved_invoice_id
     FROM rentalcollection
     WHERE client_id = ? AND id IN (${placeholders})
     ${paidFilterSql}
     AND (
       (invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != '')
       OR (bukku_invoice_id IS NOT NULL AND TRIM(COALESCE(bukku_invoice_id,'')) != '')
     )`,
    [clientId, ...rentalCollectionIds]
  );
  if (!rows.length) return result;

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return result;
  }
  const { provider, req } = resolved;

  const voidReason = includePaid ? 'Void completed refund' : 'Tenancy changed or terminated';
  const einvoiceCancelReason =
    opts.einvoiceCancelReason != null && String(opts.einvoiceCancelReason).trim() !== ''
      ? String(opts.einvoiceCancelReason).trim()
      : 'change tenancy';

  for (const row of rows) {
    const invoiceId = String(row.resolved_invoice_id || '').trim();
    if (!invoiceId) continue;
    try {
      // MyInvois: only cancel when invoice has e-invoice (see cancelEInvoiceIfEnabled); else void sales invoice only.
      const einvoiceCancel = await cancelEInvoiceIfEnabled(req, {
        provider,
        invoiceIdOrDocNo: invoiceId,
        reason: einvoiceCancelReason
      });
      if (!einvoiceCancel.ok && einvoiceCancel.reason) {
        result.errors.push(`E-invoice cancel ${invoiceId}: ${einvoiceCancel.reason}`);
        console.warn('[voidOrDeleteInvoicesForRentalCollectionIds] e-invoice cancel', invoiceId, einvoiceCancel.reason);
      }
      // Void invoice in accounting (all four use void, not delete)
      if (provider === 'bukku') {
        await bukkuInvoice.updateinvoicestatus(req, invoiceId, { status: 'void', void_reason: voidReason });
        result.voided++;
        await markRentalcollectionAccountingInvoiceVoided(clientId, row.id);
      } else if (provider === 'xero') {
        let voidRes = await xeroInvoice.update(req, invoiceId, { Status: 'VOIDED' });
        if (!voidRes?.ok) {
          // Paid invoices cannot be voided until related payments are reversed.
          const msg = formatProviderError(voidRes?.error);
          if (!/payment|paid|cannot be voided|validation/i.test(msg)) {
            throw new Error(msg || `Xero void failed for ${invoiceId}`);
          }
          const where = `Invoice.InvoiceID=guid("${invoiceId}")`;
          const listRes = await xeroPayment.listPayments(req, { where });
          if (!listRes?.ok) {
            throw new Error(`List payment for ${invoiceId} failed: ${formatProviderError(listRes?.error)}`);
          }
          const payments = Array.isArray(listRes?.data?.Payments) ? listRes.data.Payments : [];
          for (const p of payments) {
            const pid = p?.PaymentID ?? p?.PaymentId;
            if (!pid) continue;
            const delRes = await xeroPayment.deletePayment(req, String(pid));
            if (!delRes?.ok) {
              throw new Error(`Reverse payment ${pid} failed: ${formatProviderError(delRes?.error)}`);
            }
          }
          voidRes = await xeroInvoice.update(req, invoiceId, { Status: 'VOIDED' });
          if (!voidRes?.ok) {
            throw new Error(`Xero void after reverse failed: ${formatProviderError(voidRes?.error)}`);
          }
        }
        result.voided++;
        await markRentalcollectionAccountingInvoiceVoided(clientId, row.id);
      } else if (provider === 'autocount') {
        await autocountInvoice.voidInvoice(req, invoiceId, {});
        result.voided++;
        await markRentalcollectionAccountingInvoiceVoided(clientId, row.id);
      } else if (provider === 'sql') {
        try {
          await sqlInvoice.updateInvoice(req, invoiceId, { Status: 'Voided' });
          result.voided++;
          await markRentalcollectionAccountingInvoiceVoided(clientId, row.id);
        } catch (sqlErr) {
          const msg = `SQL void ${invoiceId}: ${formatProviderError(sqlErr) || sqlErr?.message || sqlErr}`;
          result.errors.push(msg);
          // SQL provider often rejects post-created edit/void for locked rows.
          // Keep delete flow unblocked (same strategy as contact sync skip).
          console.warn('[voidOrDeleteInvoicesForRentalCollectionIds] sql void non-fatal', invoiceId, msg);
        }
      }
    } catch (err) {
      result.errors.push(`Void invoice ${invoiceId} (${provider}): ${err?.message || err}`);
      result.fatalErrors.push(`Void invoice ${invoiceId} (${provider}): ${err?.message || err}`);
      console.warn('[voidOrDeleteInvoicesForRentalCollectionIds]', row.id, invoiceId, err?.message || err);
    }
  }
  return result;
}

/**
 * Create receipt (payment against invoice) in accounting when rentalcollection is marked paid.
 * Used by:
 * - Stripe webhook (source = 'stripe')
 * - Tenant Invoice page offline payment (source = 'manual', method = 'Cash' | 'Bank')
 * One receipt per row that has invoiceid.
 * @param {string[]} rentalcollectionIds - IDs that were just marked paid
 * @param {{ source?: 'stripe' | 'manual', method?: string, payFromDeposit?: boolean, paymentDateMalaysia?: string }} [opts] - payFromDeposit: true for forfeit (pay from Deposit liability); paymentDateMalaysia: optional YYYY-MM-DD override (Malaysia calendar) for receipt date; otherwise `paidat` from DB is converted with {@link utcDatetimeFromDbToMalaysiaDateOnly} (same business day as Portal `malaysiaNoonIsoFromYmd`).
 * @returns {Promise<{ ok: boolean, created?: number, errors?: string[], receipts?: Array<{ rentalcollectionId: string, provider: string, paymentDateMalaysia: string, receipturl?: string|null, bukku_payment_id?: string|null, accounting_receipt_document_number?: string|null }> }>}
 */
async function createReceiptForPaidRentalCollection(rentalcollectionIds, opts) {
  if (!Array.isArray(rentalcollectionIds) || rentalcollectionIds.length === 0) {
    return { ok: true, created: 0 };
  }
  const placeholders = rentalcollectionIds.map(() => '?').join(',');
  const receiptDetails = [];
  const [rows] = await pool.query(
    `SELECT id, client_id, invoiceid, bukku_invoice_id,
            COALESCE(
              NULLIF(TRIM(COALESCE(invoiceid, '')), ''),
              NULLIF(TRIM(COALESCE(bukku_invoice_id, '')), '')
            ) AS accounting_invoice_id,
            amount, paidat, referenceid, property_id, tenant_id, type_id
     FROM rentalcollection
     WHERE id IN (${placeholders}) AND ispaid = 1
       AND (
         (invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != '')
         OR (bukku_invoice_id IS NOT NULL AND TRIM(COALESCE(bukku_invoice_id,'')) != '')
       )`,
    rentalcollectionIds
  );
  if (!rows.length) return { ok: true, created: 0 };

  let created = 0;
  const errors = [];
  const byClient = new Map();
  for (const r of rows) {
    const cid = r.client_id;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid).push(r);
  }

  for (const [clientId, clientRows] of byClient) {
    const resolved = await resolveClientAccounting(clientId);
    if (!resolved.ok || !resolved.req) {
      errors.push(`Client ${clientId}: ${resolved.reason || 'no accounting'}`);
      continue;
    }
    const { provider, req } = resolved;
    let bukkuCurrencyCode = null;
    if (provider === 'bukku') {
      try {
        bukkuCurrencyCode = await getClientCurrencyCode(clientId);
      } catch (e) {
        errors.push(`Client ${clientId}: ${e?.message || 'missing operatordetail.currency'} for bukku currency_code`);
        continue;
      }
    }
    const source = opts && opts.source ? opts.source : 'stripe';
    const method = opts && opts.method ? String(opts.method) : null;
    const payFromDeposit = !!(opts && opts.payFromDeposit);

    for (const row of clientRows) {
      const amount = Number(row.amount) || 0;
      if (amount <= 0) continue;
      const paidat = row.paidat ? (row.paidat instanceof Date ? row.paidat : new Date(row.paidat)) : new Date();
      let dateStr;
      if (opts && opts.paymentDateMalaysia && /^\d{4}-\d{2}-\d{2}$/.test(String(opts.paymentDateMalaysia).trim())) {
        dateStr = String(opts.paymentDateMalaysia).trim().slice(0, 10);
      } else {
        dateStr = paidat.toISOString ? utcDatetimeFromDbToMalaysiaDateOnly(paidat) : String(row.paidat || '').slice(0, 10);
      }
      const reference = (row.referenceid || 'Stripe').toString().trim().slice(0, 255);
      const ownerBillingPc = !payFromDeposit && (await isCashInvoiceToPropertyOwner(row.type_id));

      try {
        if (provider === 'xero') {
          // Forfeit: pay from Deposit liability; else bank/cash/stripe — use Code or AccountID (BANK often has empty Code).
          let accountObj = null;
          if (payFromDeposit) {
            const dest = await getPaymentDestinationAccountId(clientId, 'xero', 'deposit');
            accountObj = dest?.accountId ? await buildXeroPaymentAccountForReceipt(req, dest.accountId) : null;
            if (!accountObj) {
              errors.push(`Rental ${row.id}: no Xero Deposit account (map account table + account_client for deposit)`);
              continue;
            }
          } else if (ownerBillingPc) {
            const dest = await getPaymentDestinationAccountId(clientId, 'xero', 'platform_collection');
            accountObj = dest?.accountId ? await buildXeroPaymentAccountForReceipt(req, dest.accountId) : null;
            if (!accountObj) {
              errors.push(`Rental ${row.id}: no Xero Platform Collection account (map account table + account_client for platform_collection)`);
              continue;
            }
          } else {
            const destKey = source === 'stripe' ? 'stripe' : (method && method.toLowerCase() === 'cash' ? 'cash' : 'bank');
            const dest = await getPaymentDestinationAccountId(clientId, 'xero', destKey);
            accountObj = dest?.accountId ? await buildXeroPaymentAccountForReceipt(req, dest.accountId) : null;
            if (!accountObj) {
              const env = (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
              if (env) {
                const c = await findXeroPaymentEnabledAccountCode(req, [env]) || env;
                if (c) accountObj = { Code: c };
              }
            }
            if (!accountObj) {
              errors.push(`Rental ${row.id}: no Xero ${destKey} account and XERO_DEFAULT_BANK_ACCOUNT_CODE not set`);
              continue;
            }
          }
          const payRes = await xeroPayment.createPayment(req, {
            Invoice: { InvoiceID: String(row.accounting_invoice_id) },
            Account: accountObj,
            Date: dateStr,
            Amount: amount,
            Reference: reference
          });
          let finalPayRes = payRes;
          if (!finalPayRes?.ok && isXeroInvalidPaymentAccountError(finalPayRes?.error)) {
            const fallbackCode = await findXeroPaymentEnabledAccountCode(req, [
              (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim(),
              accountObj.Code || ''
            ]);
            if (fallbackCode && fallbackCode !== accountObj.Code) {
              finalPayRes = await xeroPayment.createPayment(req, {
                Invoice: { InvoiceID: String(row.accounting_invoice_id) },
                Account: { Code: fallbackCode },
                Date: dateStr,
                Amount: amount,
                Reference: reference
              });
            }
          }
          if (!finalPayRes?.ok) {
            let msg = formatProviderError(finalPayRes?.error) || 'xero payment failed';
            if (isXeroInvalidPaymentAccountError(finalPayRes?.error)) {
              msg = `${msg}. Xero payment account must be BANK type or have "Enable payments to this account" turned on`;
            }
            errors.push(`Rental ${row.id}: ${msg}`);
            continue;
          }
          const payment = finalPayRes?.data?.Payments?.[0] ?? finalPayRes?.Payments?.[0] ?? null;
          const paymentId = payment?.PaymentID ?? payment?.PaymentId ?? null;
          const paymentNumber =
            payment?.Reference ??
            payment?.BatchPaymentID ??
            payment?.BankTransactionID ??
            null;
          const receiptUrl = (await getInvoiceUrl(req, 'xero', String(row.accounting_invoice_id)))
            || buildXeroInvoiceOpenUrl(String(row.accounting_invoice_id));
          try {
            await pool.query(
              `UPDATE rentalcollection
                 SET receipturl = COALESCE(?, receipturl),
                     bukku_payment_id = COALESCE(?, bukku_payment_id),
                     accounting_receipt_document_number = COALESCE(?, accounting_receipt_document_number),
                     accounting_receipt_snapshot = ?
               WHERE id = ?`,
              [
                receiptUrl || null,
                paymentId ? String(paymentId) : null,
                paymentNumber ? String(paymentNumber) : null,
                payment ? JSON.stringify(payment) : null,
                row.id
              ]
            );
          } catch (wErr) {
            console.warn('[createReceiptForPaidRentalCollection] write xero receipt snapshot failed', row.id, wErr?.message || wErr);
          }
          created++;
          continue;
        }

        if (provider === 'bukku') {
          // Destination account from account table: bank/cash/stripe/deposit (deposit for forfeit); owner commission/mgmt → Platform Collection.
          let destKey = payFromDeposit ? 'deposit' : (source === 'stripe' ? 'stripe' : (method && method.toLowerCase() === 'cash' ? 'cash' : 'bank'));
          if (ownerBillingPc) {
            destKey = 'platform_collection';
          }
          const dest = await getPaymentDestinationAccountId(clientId, 'bukku', destKey);
          const bankAccountId = dest ? dest.accountId : '';
          if (!bankAccountId) {
            errors.push(`Rental ${row.id}: no Bukku account for ${destKey} (map account table + account_client)`);
            continue;
          }
          const invoiceToOwner = await isCashInvoiceToPropertyOwner(row.type_id);
          const contactRes = await getContactForRentalItem(clientId, provider, req, {
            invoiceToOwner,
            propertyId: row.property_id || null,
            tenantId: row.tenant_id
          });
          if (!contactRes.ok) {
            errors.push(`Rental ${row.id}: contact ${contactRes.reason}`);
            continue;
          }
          const targetTxId = resolveBukkuSalesTargetTransactionId(row);
          if (targetTxId == null || !Number.isFinite(targetTxId) || targetTxId <= 0) {
            errors.push(
              `Rental ${row.id}: Bukku receipt needs numeric sales invoice id (set bukku_invoice_id from Bukku; invoiceid IV-xxxxx cannot be used as API id)`
            );
            continue;
          }
          const payload = {
            contact_id: Number(contactRes.contactId),
            date: dateStr,
            currency_code: bukkuCurrencyCode,
            exchange_rate: 1,
            amount,
            link_items: [{ target_transaction_id: targetTxId, apply_amount: amount }],
            deposit_items: [{ account_id: Number(bankAccountId), amount }],
            status: 'ready'
          };
          const payRes = await bukkuPayment.createPayment(req, payload);
          if (!payRes?.ok) {
            errors.push(`Rental ${row.id}: ${formatProviderError(payRes?.error) || 'bukku receipt failed'}`);
            continue;
          }
          const tx = payRes?.data?.transaction && typeof payRes.data.transaction === 'object'
            ? payRes.data.transaction
            : (payRes?.data && typeof payRes.data === 'object' ? payRes.data : null);
          const paymentId = tx?.id != null && String(tx.id).trim() ? String(tx.id).trim() : null;
          const receiptUrl = tx?.short_link != null && String(tx.short_link).trim() ? String(tx.short_link).trim() : null;
          const receiptNumber = tx?.number != null && String(tx.number).trim() ? String(tx.number).trim() : null;
          try {
            await pool.query(
              `UPDATE rentalcollection
               SET receipturl = COALESCE(?, receipturl),
                   bukku_payment_id = COALESCE(?, bukku_payment_id),
                   accounting_receipt_document_number = COALESCE(?, accounting_receipt_document_number),
                   accounting_receipt_snapshot = ?
               WHERE id = ?`,
              [receiptUrl, paymentId, receiptNumber, tx ? JSON.stringify(tx) : null, row.id]
            );
          } catch (wErr) {
            console.warn('[createReceiptForPaidRentalCollection] write bukku receipt snapshot failed', row.id, wErr?.message || wErr);
          }
          receiptDetails.push({
            rentalcollectionId: row.id,
            provider: 'bukku',
            paymentDateMalaysia: dateStr,
            receipturl: receiptUrl,
            bukku_payment_id: paymentId,
            accounting_receipt_document_number: receiptNumber
          });
          created++;
          continue;
        }

        if (provider === 'autocount') {
          let payload = { invoiceId: String(row.accounting_invoice_id), amount, date: dateStr, reference };
          if (payFromDeposit) {
            const dest = await getPaymentDestinationAccountId(clientId, 'autocount', 'deposit');
            if (!dest || !dest.accountId) {
              errors.push(`Rental ${row.id}: no AutoCount Deposit account (map account table + account_client for deposit)`);
              continue;
            }
            payload = { ...payload, accountCode: String(dest.accountId).trim() };
          } else if (ownerBillingPc) {
            const dest = await getPaymentDestinationAccountId(clientId, 'autocount', 'platform_collection');
            if (!dest || !dest.accountId) {
              errors.push(`Rental ${row.id}: no AutoCount Platform Collection account (map account table + account_client for platform_collection)`);
              continue;
            }
            payload = { ...payload, accountCode: String(dest.accountId).trim() };
          }
          const res = await autocountReceipt.createReceipt(req, payload);
          if (!res.ok) {
            errors.push(`Rental ${row.id}: ${res?.error?.message ?? res?.error ?? 'autocount receipt failed'}`);
            continue;
          }
          created++;
          continue;
        }

        if (provider === 'sql') {
          let destKey = payFromDeposit
            ? 'deposit'
            : (source === 'stripe' ? 'stripe' : (method && method.toLowerCase() === 'cash' ? 'cash' : 'bank'));
          if (!payFromDeposit && ownerBillingPc) {
            destKey = 'platform_collection';
          }
          const methodKey = method && String(method).trim().toLowerCase() === 'cash' ? 'cash' : 'bank';
          let payload = {
            invoiceId: String(row.accounting_invoice_id),
            amount,
            date: dateStr,
            reference,
            paymentMethod: ''
          };
          // SQL Customer Payment requires customer selection; derive it from source invoice.
          try {
            const invRes = await sqlInvoice.getInvoice(req, String(row.accounting_invoice_id));
            const invData = invRes?.data;
            const invRow =
              (Array.isArray(invData?.data) && invData.data[0]) ||
              (invData?.data && typeof invData.data === 'object' ? invData.data : null) ||
              (invData && typeof invData === 'object' ? invData : null);
            const customerCode = String(invRow?.code || invRow?.Code || '').trim();
            const companyName = String(invRow?.companyname || invRow?.CompanyName || '').trim();
            const currencyCode = String(invRow?.currencycode || invRow?.CurrencyCode || '----').trim();
            payload = {
              ...payload,
              code: customerCode || payload.code,
              companyname: companyName || payload.companyname,
              currencycode: currencyCode || payload.currencycode,
              // Keep both snake/camel/Pascal variants because SQL API is inconsistent by endpoint.
              paymentmethod: '',
              PaymentMethod: ''
            };
          } catch (invErr) {
            console.warn('[createReceiptForPaidRentalCollection] sql invoice read before receipt failed', {
              rentalId: row.id,
              invoiceId: row.accounting_invoice_id,
              error: formatProviderError(invErr)
            });
          }
          {
            const dest = await getPaymentDestinationAccountId(clientId, 'sql', destKey);
            if (!dest || !dest.accountId) {
              if (payFromDeposit) {
                errors.push(`Rental ${row.id}: no SQL Deposit account (map account table + account_client for deposit)`);
                continue;
              }
            } else {
              const mappedCode = String(dest.accountId || '').trim();
              const resolvedPaymentCode = await resolveSqlPaymentAccountCode(req, [
                mappedCode,
                method || '',
                destKey
              ]);
              const cfg = await getSqlReceiptMethodConfig(req, methodKey);
              const resolvedMethodCode = await resolveSqlPaymentMethodCode(req, [
                cfg.paymentMethodCode,
                method || '',
                destKey,
                mappedCode
              ]);
              const finalPaymentCode = String(resolvedMethodCode || cfg.paymentMethodCode || '').trim();
              const finalReceiptAccountCode = String(cfg.receiptAccountCode || '').trim();
              payload = {
                ...payload,
                ...(finalPaymentCode
                  ? {
                      paymentMethod: finalPaymentCode,
                      paymentmethod: finalPaymentCode,
                      PaymentMethod: finalPaymentCode
                    }
                  : {}),
                ...(finalReceiptAccountCode
                  ? {
                      accountCode: finalReceiptAccountCode,
                      account: finalReceiptAccountCode,
                      journal: finalReceiptAccountCode
                    }
                  : {})
              };
              if (!finalPaymentCode) {
                console.warn('[createReceiptForPaidRentalCollection] sql payment method code missing', {
                  rentalId: row.id,
                  invoiceId: row.accounting_invoice_id,
                  hint: 'Set sqlaccount_payment_method_code_bank/cash in operator accounting (SQL integration)'
                });
              }
            }
          }
          console.log('[createReceiptForPaidRentalCollection] sql receipt request', {
            rentalId: row.id,
            invoiceId: row.accounting_invoice_id,
            payloadPreview: previewJson(payload, 1000)
          });
          const res = await sqlReceipt.createReceipt(req, payload);
          const receiptMeta = extractSqlReceiptMeta(res);
          console.log('[createReceiptForPaidRentalCollection] sql receipt response', {
            rentalId: row.id,
            invoiceId: row.accounting_invoice_id,
            ok: !!res?.ok,
            status: res?.status ?? null,
            receiptId: receiptMeta.receiptId,
            receiptNo: receiptMeta.receiptNo,
            responsePreview: previewJson(res?.data ?? res?.error ?? null, 1200)
          });
          if (!res.ok) {
            const msg = formatProviderError(res?.error) || 'sql receipt failed';
            // Do not fail mark-as-paid for SQL receipt API mismatch; keep as best-effort and log.
            console.warn('[createReceiptForPaidRentalCollection] sql receipt non-fatal', {
              rentalId: row.id,
              invoiceId: row.accounting_invoice_id,
              error: msg
            });
            continue;
          }
          try {
            await pool.query(
              `UPDATE rentalcollection
                 SET receipturl = COALESCE(?, receipturl),
                     bukku_payment_id = COALESCE(?, bukku_payment_id),
                     accounting_receipt_document_number = COALESCE(?, accounting_receipt_document_number),
                     accounting_receipt_snapshot = ?
               WHERE id = ?`,
              [
                receiptMeta.receiptUrl,
                receiptMeta.receiptId,
                receiptMeta.receiptNo,
                receiptMeta.snapshot ? JSON.stringify(receiptMeta.snapshot) : null,
                row.id
              ]
            );
          } catch (wErr) {
            console.warn('[createReceiptForPaidRentalCollection] write sql receipt snapshot failed', row.id, wErr?.message || wErr);
          }
          created++;
          continue;
        }

        errors.push(`Rental ${row.id}: unsupported provider ${provider}`);
      } catch (err) {
        errors.push(`Rental ${row.id}: ${err?.message || 'receipt failed'}`);
      }
    }
  }

  // After receipts: if tenancy was inactive, check if all due rental is now paid; if yes, restore (active=1, extend TTLock, unfreeze CNYIoT).
  try {
    const placeholders2 = rentalcollectionIds.map(() => '?').join(',');
    const [tidRows] = await pool.query(
      `SELECT DISTINCT tenancy_id FROM rentalcollection WHERE id IN (${placeholders2}) AND tenancy_id IS NOT NULL`,
      rentalcollectionIds
    );
    const tenancyIds = [...new Set((tidRows || []).map((r) => r.tenancy_id).filter(Boolean))];
    const { checkAndRestoreTenancyIfFullyPaid } = require('../tenancysetting/tenancy-active.service');
    for (const tenancyId of tenancyIds) {
      try {
        await checkAndRestoreTenancyIfFullyPaid(tenancyId);
      } catch (e) {
        console.warn('[createReceiptForPaidRentalCollection] checkAndRestoreTenancyIfFullyPaid', tenancyId, e?.message || e);
      }
    }
  } catch (e) {
    console.warn('[createReceiptForPaidRentalCollection] tenancy restore check failed', e?.message || e);
  }

  return {
    ok: true,
    created,
    errors: errors.length ? errors : undefined,
    receipts: receiptDetails.length ? receiptDetails : undefined
  };
}

/**
 * Create refund in accounting when admindashboard marks refunddeposit as done (#buttonmarkasrefund).
 * Bukku: Sales Refund (pay from Deposit liability back to tenant). Xero/AutoCount/SQL: equivalent if supported.
 * @param {string} clientId
 * @param {string} refundDepositId - refunddeposit.id
 * @param {{ amount?: number, paymentDate?: string, paymentMethod?: string }} [options] - optional amount/date/method override
 * @returns {Promise<{ ok: boolean, refundId?: string, refundUrl?: string | null, refundLabel?: string | null, provider?: string, reason?: string }>}
 */
async function createRefundForRefundDeposit(clientId, refundDepositId, options = {}) {
  if (!clientId || !refundDepositId) return { ok: false, reason: 'MISSING_PARAMS' };
  console.log('[refund-complete] createRefundForRefundDeposit:start', {
    clientId,
    refundDepositId,
    amountOverride: options?.amount,
    paymentDate: options?.paymentDate || null,
    paymentMethod: options?.paymentMethod || null
  });
  const [rows] = await pool.query(
    `SELECT rd.id, rd.amount, rd.tenant_id, rd.client_id, rd.created_at, rd.roomtitle, rd.tenantname,
            rm.title_fld AS room_title_fld,
            tn.fullname AS tenant_fullname
     FROM refunddeposit rd
     LEFT JOIN roomdetail rm ON rm.id = rd.room_id
     LEFT JOIN tenantdetail tn ON tn.id = rd.tenant_id
     WHERE rd.id = ? AND rd.client_id = ? LIMIT 1`,
    [refundDepositId, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'REFUND_DEPOSIT_NOT_FOUND' };
  const row = rows[0];
  const amount = options.amount != null && options.amount >= 0
    ? Number(options.amount)
    : (Number(row.amount) || 0);
  if (amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const resolved = await resolveClientAccounting(clientId);
  console.log('[refund-complete] createRefundForRefundDeposit:accounting-resolved', {
    refundDepositId,
    amount,
    ok: resolved?.ok,
    reason: resolved?.reason || null,
    provider: resolved?.provider || null
  });
  if (!resolved.ok || !resolved.req) return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  const { provider, req } = resolved;

  const contactRes = await getContactForRentalItem(clientId, provider, req, {
    invoiceToOwner: false,
    propertyId: null,
    tenantId: row.tenant_id
  });
  console.log('[refund-complete] createRefundForRefundDeposit:contact', {
    refundDepositId,
    provider,
    ok: contactRes?.ok,
    reason: contactRes?.reason || null,
    contactId: contactRes?.contactId || null
  });
  if (!contactRes.ok) return { ok: false, reason: `Contact: ${contactRes.reason}` };

  const dateStr = toInvoiceDateOnly(options?.paymentDate || (row.created_at || ''));
  const paymentMethod = String(options?.paymentMethod || '').trim();
  const paymentMethodKey = paymentMethod.toLowerCase() === 'cash' ? 'cash' : 'bank';
  const roomName = (row.room_title_fld || row.roomtitle || '').toString().trim();
  const tenantName = (row.tenant_fullname || row.tenantname || '').toString().trim();
  const methodLine = paymentMethod ? `Payment method: ${paymentMethod}` : '';
  const descLines = ['Refund deposit', roomName, tenantName, dateStr, methodLine].filter(Boolean);
  const description = descLines.join('\n').slice(0, 255);

  try {
    if (provider === 'bukku') {
      const depositDest = await getPaymentDestinationAccountId(clientId, 'bukku', 'deposit');
      if (!depositDest || !depositDest.accountId) return { ok: false, reason: 'No Bukku Deposit account (account table + account_client)' };
      const payFromDest = await getPaymentDestinationAccountId(clientId, 'bukku', paymentMethodKey);
      if (!payFromDest || !payFromDest.accountId) {
        return {
          ok: false,
          reason: paymentMethodKey === 'cash'
            ? 'No Bukku Cash account (account table + account_client)'
            : 'No Bukku Bank account (account table + account_client)'
        };
      }
      const payload = {
        contact_id: Number(contactRes.contactId),
        date: dateStr,
        currency_code: await getClientCurrencyCode(clientId),
        exchange_rate: 1,
        tax_mode: 'exclusive',
        description: description || 'Refund deposit',
        remarks: paymentMethod ? `Payment method: ${paymentMethod}`.slice(0, 255) : undefined,
        bank_items: [{
          line: 1,
          account_id: Number(depositDest.accountId),
          description: description || 'Refund deposit',
          amount,
          tax_code_id: null
        }],
        deposit_items: [{
          account_id: Number(payFromDest.accountId),
          amount
        }],
        status: 'ready'
      };
      console.log('[refund-complete] createRefundForRefundDeposit:bukku-request', {
        refundDepositId,
        paymentMethod,
        payFromMethod: paymentMethodKey,
        payload
      });
      // Banking expense (money out): bank_items → Deposit, deposit_items → Bank/Cash. Substance: DR Deposit, CR Bank/Cash.
      const res = await bukkuBankingExpense.create(req, payload);
      const id =
        res?.data?.transaction?.id ??
        res?.data?.id ??
        res?.id ??
        null;
      const label =
        res?.data?.transaction?.number ??
        res?.data?.number ??
        null;
      const refundUrl =
        res?.data?.transaction?.short_link ||
        res?.data?.short_link ||
        res?.short_link ||
        null;
      console.log('[refund-complete] createRefundForRefundDeposit:bukku-response', {
        refundDepositId,
        ok: res?.ok === true,
        rawDataPreview: (() => {
          try {
            return JSON.stringify(res?.data ?? null).slice(0, 800);
          } catch {
            return String(res?.data ?? null).slice(0, 800);
          }
        })(),
        refundId: id != null ? String(id) : null,
        refundLabel: label != null ? String(label) : null,
        refundUrl: refundUrl ? String(refundUrl) : null
      });
      if (res?.ok !== true) {
        return { ok: false, reason: `BUKKU_REFUND_HTTP_FAILED: ${JSON.stringify(res?.error ?? res)}` };
      }
      if (id == null || String(id).trim() === '') {
        return { ok: false, reason: 'BUKKU_REFUND_ID_MISSING' };
      }
      return {
        ok: true,
        refundId: id != null ? String(id) : undefined,
        refundUrl: refundUrl ? String(refundUrl) : null,
        refundLabel: label != null ? String(label) : null,
        provider: 'bukku'
      };
    }
    // Xero: Spend Money (Bank Transaction) – DR Deposit (liability), CR Bank. Payee = tenant.
    if (provider === 'xero') {
      const depositDest = await getPaymentDestinationAccountId(clientId, 'xero', 'deposit');
      if (!depositDest || !depositDest.accountId) return { ok: false, reason: 'No Xero Deposit account (account table + account_client)' };
      // Refund modal may default to cash. If cash mapping is empty, fall back to bank mapping.
      let payFromDest = await getPaymentDestinationAccountId(clientId, 'xero', paymentMethodKey);
      if ((!payFromDest || !payFromDest.accountId) && paymentMethodKey !== 'bank') {
        payFromDest = await getPaymentDestinationAccountId(clientId, 'xero', 'bank');
      }
      const depositAccountCode = await resolveXeroAccountCode(req, depositDest.accountId);
      const mappedPayFromRaw = payFromDest && payFromDest.accountId ? String(payFromDest.accountId).trim() : '';
      const mappedPayFromCode = mappedPayFromRaw ? await resolveXeroAccountCode(req, mappedPayFromRaw) : '';
      const envDefault = String(process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
      const bankRef = await findXeroBankAccountRef(req, [mappedPayFromRaw, mappedPayFromCode, envDefault]);
      if (!bankRef) {
        return {
          ok: false,
          reason: 'No Xero BANK account. Map Bank in operator/accounting to a real Xero BANK account code (not CURRENT), or set XERO_DEFAULT_BANK_ACCOUNT_CODE to a BANK code.'
        };
      }
      if (!depositAccountCode) return { ok: false, reason: 'No Xero Deposit account code' };
      const contactId = String(contactRes.contactId || '').trim();
      const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId);
      const payload = {
        Type: 'SPEND',
        Contact: isGuid ? { ContactID: contactId } : { Name: tenantName || 'Tenant' },
        BankAccount: bankRef,
        Date: dateStr,
        Reference: (description || 'Refund deposit').slice(0, 255),
        LineItems: [{
          Description: (description || 'Refund deposit').slice(0, 500),
          Quantity: 1,
          UnitAmount: amount,
          AccountCode: depositAccountCode
        }]
      };
      console.log('[refund-complete] createRefundForRefundDeposit:xero-request', {
        refundDepositId,
        payload
      });
      const res = await xeroBankTransaction.createBankTransaction(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.Message ?? res?.error?.message ?? res?.error ?? 'Xero refund failed');
      const bt = res.data?.BankTransactions?.[0];
      const refundId = bt?.BankTransactionID ?? bt?.BankTransactionId;
      console.log('[refund-complete] createRefundForRefundDeposit:xero-response', {
        refundDepositId,
        refundId: refundId != null ? String(refundId) : null
      });
      return { ok: true, refundId: refundId != null ? String(refundId) : undefined, refundUrl: null, provider: 'xero' };
    }

    // AutoCount: Payment (cash book) = pay out from Deposit to tenant (debtor).
    if (provider === 'autocount') {
      const dest = await getPaymentDestinationAccountId(clientId, 'autocount', 'deposit');
      if (!dest || !dest.accountId) return { ok: false, reason: 'No AutoCount Deposit account (account table + account_client)' };
      const payload = {
        master: {
          docDate: dateStr,
          payTo: tenantName || 'Tenant',
          description: description || 'Refund deposit'
        },
        details: [{ account: String(dest.accountId).trim(), amount, description: description || 'Refund deposit' }]
      };
      console.log('[refund-complete] createRefundForRefundDeposit:autocount-request', {
        refundDepositId,
        payload
      });
      const res = await autocountPayment.createPayment(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.message ?? res?.error ?? 'AutoCount refund failed');
      const docNo = res.data?.docNo ?? res.data?.DocNo ?? res.docNo;
      console.log('[refund-complete] createRefundForRefundDeposit:autocount-response', {
        refundDepositId,
        refundId: docNo != null ? String(docNo) : null
      });
      return { ok: true, refundId: docNo != null ? String(docNo) : undefined, refundUrl: null, provider: 'autocount' };
    }

    // SQL: Payment voucher = pay out from Deposit to tenant.
    if (provider === 'sql') {
      const dest = await getPaymentDestinationAccountId(clientId, 'sql', 'deposit');
      if (!dest || !dest.accountId) return { ok: false, reason: 'No SQL Deposit account (account table + account_client)' };
      const payload = {
        ContactId: String(contactRes.contactId),
        Amount: amount,
        Date: dateStr,
        Description: description || 'Refund deposit',
        AccountCode: String(dest.accountId).trim()
      };
      console.log('[refund-complete] createRefundForRefundDeposit:sql-request', {
        refundDepositId,
        payload
      });
      const res = await sqlPayment.createPayment(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.message ?? res?.error ?? 'SQL refund failed');
      const id = res.data?.id ?? res.data?.Id ?? res.data?.DocNo ?? res.id;
      console.log('[refund-complete] createRefundForRefundDeposit:sql-response', {
        refundDepositId,
        refundId: id != null ? String(id) : null
      });
      return { ok: true, refundId: id != null ? String(id) : undefined, refundUrl: null, provider: 'sql' };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    console.warn('[refund-complete] createRefundForRefundDeposit:exception', {
      refundDepositId,
      provider,
      error: err?.message || err
    });
    return { ok: false, reason: err?.message || 'REFUND_FAILED' };
  }
}

/**
 * For forfeit deposit: mark rentalcollection rows paid and create receipt (payment from Deposit liability).
 * Call after creating forfeit deposit rentalcollection + credit invoices (e.g. from tenancysetting terminate).
 * @param {string[]} rentalcollectionIds
 * @returns {Promise<{ ok: boolean, created?: number, errors?: string[] }>}
 */
async function createReceiptForForfeitDepositRentalCollection(rentalcollectionIds) {
  if (!Array.isArray(rentalcollectionIds) || rentalcollectionIds.length === 0) {
    return { ok: true, created: 0 };
  }
  const placeholders = rentalcollectionIds.map(() => '?').join(',');
  const ref = 'Forfeit from deposit';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  await pool.query(
    `UPDATE rentalcollection SET ispaid = 1, paidat = ?, referenceid = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
    [now, ref, ...rentalcollectionIds]
  );
  return createReceiptForPaidRentalCollection(rentalcollectionIds, { payFromDeposit: true, source: 'manual' });
}

module.exports = {
  resolveClientAccounting,
  getAccountMapping,
  getAccountMappingForRentalIncomeLine,
  getPaymentDestinationAccountId,
  findXeroBankAccountRef,
  buildXeroPaymentAccountForReceipt,
  getContactForRentalItem,
  createCreditInvoice,
  createCashInvoice,
  getInvoiceUrl,
  buildInvoiceDescription,
  createInvoicesForRentalRecords,
  handleTenantMeterPaymentSuccess,
  createReceiptForPaidRentalCollection,
  createRefundForRefundDeposit,
  createReceiptForForfeitDepositRentalCollection,
  voidOrDeleteInvoicesForRentalCollectionIds,
  isOwnerCommissionType,
  isCashInvoiceToPropertyOwner,
  getAccountIdByWixId,
  resolveTopupAircondAccountId,
  getBukkuSubdomainForClientInvoiceLink,
  buildRentalInvoiceDisplayUrl,
  buildRentalReceiptDisplayUrl,
  parseAccountingReceiptSnapshotJson,
  formatAccountingInvoiceReceiptLabel,
  OWNER_COMMISSION_WIX_ID,
  TOPUP_AIRCOND_ACCOUNT_ID,
  getAccountIdByPaymentType,
  getClientCurrencyCode,
  PAYMENT_TYPE_TITLES
};
