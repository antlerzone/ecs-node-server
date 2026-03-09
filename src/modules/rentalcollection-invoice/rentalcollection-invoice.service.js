/**
 * When rentalcollection rows are written (e.g. from tenant approve → generateFromTenancyByTenancyId),
 * if client has pricing plan + accounting integration: create credit invoice per item (by due date),
 * contact = property owner for owner-commission type, else tenant. Write back invoiceid + invoiceurl to rentalcollection.
 * All four platforms: Bukku, Xero, AutoCount, SQL. Invoice ID returned by all; URL: Xero (OnlineInvoice), Bukku (build), AutoCount/SQL (null or config).
 */

const pool = require('../../config/db');
const { ACCOUNTING_PLAN_IDS } = require('../access/access.service');
const { ensureContactInAccounting, writeOwnerAccount, writeTenantAccount } = require('../contact/contact-sync.service');

const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');
const bukkuRefund = require('../bukku/wrappers/refund.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const xeroBankTransaction = require('../xero/wrappers/banktransaction.wrapper');
const autocountInvoice = require('../autocount/wrappers/invoice.wrapper');
const autocountReceipt = require('../autocount/wrappers/receipt.wrapper');
const autocountPayment = require('../autocount/wrappers/payment.wrapper');
const sqlInvoice = require('../sqlaccount/wrappers/invoice.wrapper');
const sqlReceipt = require('../sqlaccount/wrappers/receipt.wrapper');
const sqlPayment = require('../sqlaccount/wrappers/payment.wrapper');
const { cancelEInvoiceIfEnabled } = require('../einvoice/einvoice.service');

const OWNER_COMMISSION_WIX_ID = '86da59c0-992c-4e40-8efd-9d6d793eaf6a';
const TOPUP_AIRCOND_WIX_ID = '18ba3daf-7208-46fc-8e97-43f34e898401'; // meter topup type

// Payment-type titles in account table (we look up by title to get account.id, then account_client / account_json)
const PAYMENT_TYPE_TITLES = {
  bank: ['Bank', 'bank'],
  cash: ['Cash', 'cash'],
  stripe: ['Stripe Current Assets', 'Stripe', 'stripe'],
  deposit: ['Deposit', 'deposit'],
  rental: ['Rent Income', 'Rental', 'rental', 'Platform Collection'],
  expense: ['Expenses', 'expense', 'Platform Collection'],
  management_fees: ['Management Fees', 'Management Fee', 'management fees'],
  owner_payout: ['Owner Payout', 'owner payout'],
  platform_collection: ['Platform Collection', 'platform collection']
};

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
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
  const [intRows] = await pool.query(
    `SELECT provider, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND enabled = 1 LIMIT 1`,
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
  const accountIdUuid = await getAccountIdByPaymentType(method);
  if (!accountIdUuid) return null;
  const mapping = await getAccountMapping(clientId, accountIdUuid, provider);
  return mapping && mapping.accountId ? { accountId: mapping.accountId } : null;
}

/**
 * Get account mapping (accountid, productId) for this client + type (account_id) + provider.
 * Uses account_client then account_json.
 */
async function getAccountMapping(clientId, typeId, provider) {
  if (!clientId || !typeId || !provider) return null;
  const [rows] = await pool.query(
    `SELECT accountid, product_id FROM account_client
     WHERE account_id = ? AND client_id = ? AND \`system\` = ? LIMIT 1`,
    [typeId, clientId, provider]
  );
  if (rows.length && rows[0].accountid != null && String(rows[0].accountid).trim() !== '') {
    return {
      accountId: String(rows[0].accountid).trim(),
      productId: rows[0].product_id != null ? String(rows[0].product_id) : null
    };
  }
  const [accRows] = await pool.query(
    'SELECT account_json FROM account WHERE id = ? LIMIT 1',
    [typeId]
  );
  if (!accRows.length) return null;
  const arr = parseJson(accRows[0].account_json);
  const entry = Array.isArray(arr) ? arr.find((a) => (a.clientId === clientId || a.client_id === clientId) && (a.system || '').toLowerCase() === provider) : null;
  if (!entry || !entry.accountid) return null;
  return {
    accountId: String(entry.accountid).trim(),
    productId: entry.productId != null ? String(entry.productId) : null
  };
}

/**
 * Get contact for credit invoice: owner-commission → invoice to owner; all others (rent, deposit, forfeit deposit, agreement fees, etc.) → invoice to tenant.
 * Tenancy setting: extend/change room/terminate create rentalcollection; forfeit deposit is credit invoice to tenant.
 * Ensures contact exists (ensureContactInAccounting) and returns contactId.
 */
async function getContactForRentalItem(clientId, provider, req, { isOwnerCommission, propertyId, tenantId }) {
  if (isOwnerCommission && propertyId) {
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
async function createCreditInvoice(req, provider, opts) {
  const { contactId, accountId, productId, amount, dueDate, title, description } = opts || {};
  if (!contactId || !accountId || amount == null) {
    return { ok: false, reason: 'MISSING_CONTACT_OR_ACCOUNT_OR_AMOUNT' };
  }
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const desc = (description != null ? String(description) : (title || 'Rental')).trim().slice(0, 2000);
  const dateStr = dueDate ? (dueDate instanceof Date ? dueDate : new Date(dueDate)).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  try {
    if (provider === 'bukku') {
      const payload = {
        payment_mode: 'credit',
        contact_id: Number(contactId),
        date: dateStr,
        currency_code: 'MYR',
        exchange_rate: 1,
        tax_mode: 'exclusive',
        form_items: [{
          account_id: Number(accountId),
          description: desc,
          unit_price: amt,
          quantity: 1
        }],
        term_items: [{ payment_due: dateStr, description: 'Due' }],
        status: 'ready'
      };
      if (productId != null && productId !== '') payload.form_items[0].product_id = Number(productId);
      const res = await bukkuInvoice.createinvoice(req, payload);
      const id = res?.data?.id ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'BUKKU_CREATE_FAILED' };
      return { ok: true, invoiceId: String(id) };
    }

    if (provider === 'xero') {
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
      const payload = {
        Type: 'ACCREC',
        Contact,
        Date: dateStr,
        DueDate: dateStr,
        LineItems: [{
          Description: desc,
          Quantity: 1,
          UnitAmount: amt,
          AccountCode: String(accountId)
        }],
        Status: 'AUTHORISED'
      };
      const res = await xeroInvoice.create(req, payload);
      const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
      const id = inv?.InvoiceID ?? inv?.InvoiceId;
      if (!id) return { ok: false, reason: res?.error || 'XERO_CREATE_FAILED' };
      return { ok: true, invoiceId: id };
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
      if (!docNo) return { ok: false, reason: res?.error || 'AUTOCOUNT_CREATE_FAILED' };
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
      const id = res?.data?.id ?? res?.data?.Id ?? res?.data?.DocNo ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'SQL_CREATE_FAILED' };
      return { ok: true, invoiceId: String(id) };
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
      const res = await xeroInvoice.getOnlineInvoiceUrl(req, invoiceId);
      return res.ok ? res.url : null;
    }
    if (provider === 'bukku' && req.client?.bukku_subdomain) {
      const sub = String(req.client.bukku_subdomain).trim();
      return `https://${sub}.bukku.my/invoices/${invoiceId}`.replace(/\/+/g, '/');
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
  const [rows] = await pool.query('SELECT id FROM account WHERE id = ? AND wix_id = ? LIMIT 1', [typeId, OWNER_COMMISSION_WIX_ID]);
  return rows.length > 0;
}

async function getAccountIdByWixId(wixId) {
  if (!wixId) return null;
  const [rows] = await pool.query('SELECT id FROM account WHERE wix_id = ? LIMIT 1', [wixId]);
  return rows[0] ? rows[0].id : null;
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
    const d = record.date instanceof Date ? record.date : new Date(record.date);
    dateStr = d.toISOString ? d.toISOString().slice(0, 10) : String(record.date).slice(0, 10);
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
  const dateVal = date != null ? (date instanceof Date ? date : new Date(date)) : new Date();
  const dateStr = dateVal.toISOString ? dateVal.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const depositAccountId = paymentAccountId != null && String(paymentAccountId).trim() !== '' ? Number(paymentAccountId) : Number(accountId);

  try {
    if (provider === 'bukku') {
      const payload = {
        payment_mode: 'cash',
        contact_id: Number(contactId),
        date: dateStr,
        currency_code: 'MYR',
        exchange_rate: 1,
        tax_mode: 'exclusive',
        form_items: [{ account_id: Number(accountId), description: desc, unit_price: amt, quantity: 1 }],
        deposit_items: [{ account_id: depositAccountId, amount: amt }],
        status: 'ready'
      };
      if (productId != null && productId !== '') payload.form_items[0].product_id = Number(productId);
      const res = await bukkuInvoice.createinvoice(req, payload);
      const id = res?.data?.id ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'BUKKU_CREATE_FAILED' };
      return { ok: true, invoiceId: String(id) };
    }

    if (provider === 'xero') {
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
      const payload = {
        Type: 'ACCREC',
        Contact,
        Date: dateStr,
        DueDate: dateStr,
        LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, AccountCode: String(accountId) }],
        Status: 'AUTHORISED'
      };
      const res = await xeroInvoice.create(req, payload);
      const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
      const id = inv?.InvoiceID ?? inv?.InvoiceId;
      if (!id) return { ok: false, reason: res?.error || 'XERO_CREATE_FAILED' };
      const bankCode = process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '';
      if (bankCode) {
        try {
          await xeroPayment.createPayment(req, {
            Invoice: { InvoiceID: id },
            Account: { Code: bankCode },
            Date: dateStr,
            Amount: amt,
            Reference: 'Meter top-up'
          });
        } catch (_) { /* optional */ }
      }
      return { ok: true, invoiceId: id };
    }

    if (provider === 'autocount') {
      const payload = {
        master: { docDate: dateStr, debtorCode: String(contactId), debtorName: desc },
        details: [{ productCode: (productId && String(productId)) || 'GENERAL', description: desc, qty: 1, unitPrice: amt }]
      };
      const res = await autocountInvoice.createInvoice(req, payload);
      const docNo = res?.data?.docNo ?? res?.data?.DocNo ?? res?.docNo;
      if (!docNo) return { ok: false, reason: res?.error || 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, invoiceId: String(docNo) };
    }

    if (provider === 'sql') {
      const payload = { contactId: String(contactId), accountId: String(accountId), amount: amt, description: desc, date: dateStr };
      const res = await sqlInvoice.createInvoice(req, payload);
      const id = res?.data?.id ?? res?.data?.Id ?? res?.data?.DocNo ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'SQL_CREATE_FAILED' };
      return { ok: true, invoiceId: String(id) };
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
 * @returns {Promise<{ ok: boolean, meterTransactionId?: string, invoiceId?: string, reason?: string }>}
 */
async function handleTenantMeterPaymentSuccess(session) {
  const meterTransactionId = session.metadata?.meter_transaction_id;
  const tenancyId = session.metadata?.tenancy_id;
  const tenantId = session.metadata?.tenant_id;
  const amountCents = session.metadata?.amount_cents != null ? parseInt(String(session.metadata.amount_cents), 10) : NaN;
  const amount = Number.isFinite(amountCents) ? amountCents / 100 : (session.amount_total != null ? session.amount_total / 100 : 0);
  const referenceId = session.payment_intent || session.id || '';

  if (!meterTransactionId) {
    return { ok: false, reason: 'MISSING_METER_TRANSACTION_ID' };
  }
  if (!tenancyId || !tenantId || amount <= 0) {
    return { ok: false, reason: 'MISSING_TENANCY_OR_TENANT_OR_AMOUNT' };
  }

  const [mtRows] = await pool.query(
    'SELECT id, tenant_id, tenancy_id, property_id, amount FROM metertransaction WHERE id = ? LIMIT 1',
    [meterTransactionId]
  );
  if (!mtRows.length) {
    return { ok: false, reason: 'METER_TRANSACTION_NOT_FOUND' };
  }
  const mt = mtRows[0];
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

  const typeId = await getAccountIdByWixId(TOPUP_AIRCOND_WIX_ID);
  const propertyId = mt.property_id || null;
  if (clientId && typeId) {
    const resolved = await resolveClientAccounting(clientId);
    if (resolved.ok && resolved.req) {
      const { provider, req } = resolved;
      const mapping = await getAccountMapping(clientId, typeId, provider);
      if (mapping && mapping.accountId) {
        const contactRes = await getContactForRentalItem(clientId, provider, req, {
          isOwnerCommission: false,
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
          description: itemDescription
        });
          if (cashRes.ok) {
            const invoiceUrl = await getInvoiceUrl(req, provider, cashRes.invoiceId);
            await pool.query(
              'UPDATE metertransaction SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ? WHERE id = ?',
              [cashRes.invoiceId, invoiceUrl || null, cashRes.invoiceId, meterTransactionId]
            );
            return { ok: true, meterTransactionId, invoiceId: cashRes.invoiceId };
          }
        }
      }
    }
  }

  return { ok: true, meterTransactionId };
}

/**
 * After rentalcollection rows are inserted: create credit invoice per row (when client has accounting),
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
    return { ok: true, created: 0 };
  }
  const { provider, req } = resolved;
  let created = 0;
  const errors = [];
  for (const r of records) {
    const mapping = await getAccountMapping(clientId, r.type_id, provider);
    if (!mapping || !mapping.accountId) {
      errors.push(`No account mapping for type ${r.type_id}`);
      continue;
    }
    const isOwnerCommission = await isOwnerCommissionType(r.type_id);
    const contactRes = await getContactForRentalItem(clientId, provider, req, {
      isOwnerCommission,
      propertyId: r.property_id,
      tenantId: r.tenant_id
    });
    if (!contactRes.ok) {
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
    const invRes = await createCreditInvoice(req, provider, {
      contactId: contactRes.contactId,
      accountId: mapping.accountId,
      productId: mapping.productId,
      amount: r.amount,
      dueDate: r.date,
      description: itemDescription
    });
    if (!invRes.ok) {
      errors.push(`Invoice for ${r.id}: ${invRes.reason}`);
      continue;
    }
    const invoiceUrl = await getInvoiceUrl(req, provider, invRes.invoiceId);
    await pool.query(
      'UPDATE rentalcollection SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ? WHERE id = ?',
      [invRes.invoiceId, invoiceUrl || null, invRes.invoiceId, r.id]
    );
    created++;
  }
  return { ok: true, created, errors: errors.length ? errors : undefined };
}

/**
 * Void invoices in the accounting system for given rentalcollection rows (e.g. before deleting
 * those rows in tenancy terminate / change room / cancel booking). Only unpaid rows (ispaid = 0)
 * with invoiceid are sent to the provider; client must have accounting integration.
 * All four systems use void (no delete). Failures are logged but do not throw.
 * @param {string} clientId
 * @param {string[]} rentalCollectionIds - rentalcollection.id list
 * @returns {Promise<{ voided: number, errors: string[] }>}
 */
async function voidOrDeleteInvoicesForRentalCollectionIds(clientId, rentalCollectionIds) {
  const result = { voided: 0, errors: [] };
  if (!clientId || !Array.isArray(rentalCollectionIds) || rentalCollectionIds.length === 0) {
    return result;
  }
  const placeholders = rentalCollectionIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, invoiceid FROM rentalcollection
     WHERE client_id = ? AND id IN (${placeholders})
     AND ispaid = 0
     AND invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != ''`,
    [clientId, ...rentalCollectionIds]
  );
  if (!rows.length) return result;

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return result;
  }
  const { provider, req } = resolved;

  const voidReason = 'Tenancy changed or terminated';

  for (const row of rows) {
    const invoiceId = String(row.invoiceid || '').trim();
    if (!invoiceId) continue;
    try {
      // If client has e-invoice (MyInvois) enabled, cancel e-invoice first so LHDN is updated (reason required by most APIs)
      const einvoiceCancel = await cancelEInvoiceIfEnabled(req, {
        provider,
        invoiceIdOrDocNo: invoiceId,
        reason: 'Extend/Cancel'
      });
      if (!einvoiceCancel.ok && einvoiceCancel.reason) {
        result.errors.push(`E-invoice cancel ${invoiceId}: ${einvoiceCancel.reason}`);
        console.warn('[voidOrDeleteInvoicesForRentalCollectionIds] e-invoice cancel', invoiceId, einvoiceCancel.reason);
      }
      // Void invoice in accounting (all four use void, not delete)
      if (provider === 'bukku') {
        await bukkuInvoice.updateinvoicestatus(req, invoiceId, { status: 'void', void_reason: voidReason });
        result.voided++;
      } else if (provider === 'xero') {
        await xeroInvoice.update(req, invoiceId, { Status: 'VOIDED' });
        result.voided++;
      } else if (provider === 'autocount') {
        await autocountInvoice.voidInvoice(req, invoiceId, {});
        result.voided++;
      } else if (provider === 'sql') {
        try {
          await sqlInvoice.updateInvoice(req, invoiceId, { Status: 'Voided' });
          result.voided++;
        } catch (sqlErr) {
          result.errors.push(`SQL void ${invoiceId}: ${sqlErr?.message || sqlErr}`);
        }
      }
    } catch (err) {
      result.errors.push(`Void invoice ${invoiceId} (${provider}): ${err?.message || err}`);
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
 * @param {{ source?: 'stripe' | 'manual', method?: string, payFromDeposit?: boolean }} [opts] - payFromDeposit: true for forfeit (pay from Deposit liability)
 * @returns {Promise<{ ok: boolean, created?: number, errors?: string[] }>}
 */
async function createReceiptForPaidRentalCollection(rentalcollectionIds, opts) {
  if (!Array.isArray(rentalcollectionIds) || rentalcollectionIds.length === 0) {
    return { ok: true, created: 0 };
  }
  const placeholders = rentalcollectionIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, client_id, invoiceid, amount, paidat, referenceid, property_id, tenant_id, type_id
     FROM rentalcollection
     WHERE id IN (${placeholders}) AND ispaid = 1 AND invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != ''`,
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
    const source = opts && opts.source ? opts.source : 'stripe';
    const method = opts && opts.method ? String(opts.method) : null;
    const payFromDeposit = !!(opts && opts.payFromDeposit);

    for (const row of clientRows) {
      const amount = Number(row.amount) || 0;
      if (amount <= 0) continue;
      const paidat = row.paidat ? (row.paidat instanceof Date ? row.paidat : new Date(row.paidat)) : new Date();
      const dateStr = paidat.toISOString ? paidat.toISOString().slice(0, 10) : String(row.paidat || '').slice(0, 10);
      const reference = (row.referenceid || 'Stripe').toString().trim().slice(0, 255);

      try {
        if (provider === 'xero') {
          // Forfeit: pay from Deposit liability; else from bank (env default).
          let paymentAccountCode = '';
          if (payFromDeposit) {
            const dest = await getPaymentDestinationAccountId(clientId, 'xero', 'deposit');
            paymentAccountCode = dest && dest.accountId ? String(dest.accountId).trim() : '';
            if (!paymentAccountCode) {
              errors.push(`Rental ${row.id}: no Xero Deposit account (map account table + account_client for deposit)`);
              continue;
            }
          } else {
            paymentAccountCode = (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
            if (!paymentAccountCode) {
              errors.push(`Rental ${row.id}: XERO_DEFAULT_BANK_ACCOUNT_CODE not set`);
              continue;
            }
          }
          await xeroPayment.createPayment(req, {
            Invoice: { InvoiceID: String(row.invoiceid) },
            Account: { Code: paymentAccountCode },
            Date: dateStr,
            Amount: amount,
            Reference: reference
          });
          created++;
          continue;
        }

        if (provider === 'bukku') {
          // Destination account from account table: bank/cash/stripe/deposit (deposit for forfeit).
          const destKey = payFromDeposit ? 'deposit' : (source === 'stripe' ? 'stripe' : (method && method.toLowerCase() === 'cash' ? 'cash' : 'bank'));
          const dest = await getPaymentDestinationAccountId(clientId, 'bukku', destKey);
          const bankAccountId = dest ? dest.accountId : '';
          if (!bankAccountId) {
            errors.push(`Rental ${row.id}: no Bukku account for ${destKey} (map account table + account_client)`);
            continue;
          }
          const isOwnerCommission = await isOwnerCommissionType(row.type_id);
          const contactRes = await getContactForRentalItem(clientId, provider, req, {
            isOwnerCommission,
            propertyId: row.property_id || null,
            tenantId: row.tenant_id
          });
          if (!contactRes.ok) {
            errors.push(`Rental ${row.id}: contact ${contactRes.reason}`);
            continue;
          }
          const payload = {
            contact_id: Number(contactRes.contactId),
            number: reference.slice(0, 50) || `RC-${row.id}`,
            date: new Date(paidat).toISOString(),
            currency_code: 'MYR',
            exchange_rate: 1,
            amount,
            link_items: [{ target_transaction_id: Number(row.invoiceid), apply_amount: amount }],
            deposit_items: [{ account_id: Number(bankAccountId), amount }],
            status: 'ready'
          };
          await bukkuPayment.createPayment(req, payload);
          created++;
          continue;
        }

        if (provider === 'autocount') {
          let payload = { invoiceId: String(row.invoiceid), amount, date: dateStr, reference };
          if (payFromDeposit) {
            const dest = await getPaymentDestinationAccountId(clientId, 'autocount', 'deposit');
            if (!dest || !dest.accountId) {
              errors.push(`Rental ${row.id}: no AutoCount Deposit account (map account table + account_client for deposit)`);
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
          let payload = { invoiceId: String(row.invoiceid), amount, date: dateStr, reference };
          if (payFromDeposit) {
            const dest = await getPaymentDestinationAccountId(clientId, 'sql', 'deposit');
            if (!dest || !dest.accountId) {
              errors.push(`Rental ${row.id}: no SQL Deposit account (map account table + account_client for deposit)`);
              continue;
            }
            payload = { ...payload, accountCode: String(dest.accountId).trim() };
          }
          const res = await sqlReceipt.createReceipt(req, payload);
          if (!res.ok) {
            errors.push(`Rental ${row.id}: ${res?.error?.message ?? res?.error ?? 'sql receipt failed'}`);
            continue;
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

  return { ok: true, created, errors: errors.length ? errors : undefined };
}

/**
 * Create refund in accounting when admindashboard marks refunddeposit as done (#buttonmarkasrefund).
 * Bukku: Sales Refund (pay from Deposit liability back to tenant). Xero/AutoCount/SQL: equivalent if supported.
 * @param {string} clientId
 * @param {string} refundDepositId - refunddeposit.id
 * @param {{ amount?: number }} [options] - optional amount override (e.g. partial refund; remainder = forfeit)
 * @returns {Promise<{ ok: boolean, refundId?: string, reason?: string }>}
 */
async function createRefundForRefundDeposit(clientId, refundDepositId, options = {}) {
  if (!clientId || !refundDepositId) return { ok: false, reason: 'MISSING_PARAMS' };
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
  if (!resolved.ok || !resolved.req) return { ok: false, reason: resolved.reason || 'NO_ACCOUNTING' };
  const { provider, req } = resolved;

  const contactRes = await getContactForRentalItem(clientId, provider, req, {
    isOwnerCommission: false,
    propertyId: null,
    tenantId: row.tenant_id
  });
  if (!contactRes.ok) return { ok: false, reason: `Contact: ${contactRes.reason}` };

  const dateVal = row.created_at ? new Date(row.created_at) : new Date();
  const dateStr = dateVal.toISOString ? dateVal.toISOString().slice(0, 10) : '';
  const roomName = (row.room_title_fld || row.roomtitle || '').toString().trim();
  const tenantName = (row.tenant_fullname || row.tenantname || '').toString().trim();
  const descLines = ['Refund deposit', roomName, tenantName, dateStr].filter(Boolean);
  const description = descLines.join('\n').slice(0, 255);

  try {
    if (provider === 'bukku') {
      const dest = await getPaymentDestinationAccountId(clientId, 'bukku', 'deposit');
      if (!dest || !dest.accountId) return { ok: false, reason: 'No Bukku Deposit account (account table + account_client)' };
      const payload = {
        contact_id: Number(contactRes.contactId),
        date: new Date(dateVal).toISOString(),
        currency_code: 'MYR',
        exchange_rate: 1,
        description: description || 'Refund deposit',
        deposit_items: [{ account_id: Number(dest.accountId), amount }],
        status: 'ready'
      };
      const res = await bukkuRefund.createrefund(req, payload);
      const id = res?.data?.id ?? res?.id;
      return { ok: true, refundId: id != null ? String(id) : undefined };
    }
    // Xero: Spend Money (Bank Transaction) – DR Deposit (liability), CR Bank. Payee = tenant.
    if (provider === 'xero') {
      const depositDest = await getPaymentDestinationAccountId(clientId, 'xero', 'deposit');
      if (!depositDest || !depositDest.accountId) return { ok: false, reason: 'No Xero Deposit account (account table + account_client)' };
      const bankDest = await getPaymentDestinationAccountId(clientId, 'xero', 'bank');
      const bankCode = (bankDest && bankDest.accountId ? String(bankDest.accountId).trim() : '')
        || (process.env.XERO_DEFAULT_BANK_ACCOUNT_CODE || '').trim();
      if (!bankCode) return { ok: false, reason: 'No Xero Bank account (account_client or XERO_DEFAULT_BANK_ACCOUNT_CODE)' };
      const contactId = String(contactRes.contactId || '').trim();
      const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId);
      const payload = {
        Type: 'SPEND',
        Contact: isGuid ? { ContactID: contactId } : { Name: tenantName || 'Tenant' },
        BankAccount: { Code: bankCode },
        Date: dateStr,
        Reference: (description || 'Refund deposit').slice(0, 255),
        LineItems: [{
          Description: (description || 'Refund deposit').slice(0, 500),
          Quantity: 1,
          UnitAmount: amount,
          AccountCode: String(depositDest.accountId).trim()
        }]
      };
      const res = await xeroBankTransaction.createBankTransaction(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.Message ?? res?.error?.message ?? res?.error ?? 'Xero refund failed');
      const bt = res.data?.BankTransactions?.[0];
      const refundId = bt?.BankTransactionID ?? bt?.BankTransactionId;
      return { ok: true, refundId: refundId != null ? String(refundId) : undefined };
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
      const res = await autocountPayment.createPayment(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.message ?? res?.error ?? 'AutoCount refund failed');
      const docNo = res.data?.docNo ?? res.data?.DocNo ?? res.docNo;
      return { ok: true, refundId: docNo != null ? String(docNo) : undefined };
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
      const res = await sqlPayment.createPayment(req, payload);
      if (!res || !res.ok) throw new Error(res?.error?.message ?? res?.error ?? 'SQL refund failed');
      const id = res.data?.id ?? res.data?.Id ?? res.data?.DocNo ?? res.id;
      return { ok: true, refundId: id != null ? String(id) : undefined };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
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
  getPaymentDestinationAccountId,
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
  getAccountIdByWixId,
  OWNER_COMMISSION_WIX_ID,
  TOPUP_AIRCOND_WIX_ID,
  getAccountIdByPaymentType,
  PAYMENT_TYPE_TITLES
};
