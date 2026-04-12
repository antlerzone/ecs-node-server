/**
 * Create accounting purchase (cash purchase) when client marks bills as paid (#buttonpay / #buttonbulkpaid).
 * One bill = one purchase: contact = supplier (supplierdetail), description = property | supplier | description,
 * DR = expense account (account table Expenses/expense), CR = payment method (Bank/Cash from #dropdownpaymentmethod).
 * Preconditions: client has pricing plan + accounting integration, supplier has contact in accounting.
 */

const pool = require('../../config/db');
const {
  resolveClientAccounting,
  getAccountMapping,
  getPaymentDestinationAccountId,
  getAccountIdByPaymentType,
  getClientCurrencyCode,
  buildXeroPaymentAccountForReceipt
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { ensureContactInAccounting } = require('../contact/contact-sync.service');
const { recordAccountingError } = require('../help/help.service');
const bukkuPurchaseBill = require('../bukku/wrappers/purchaseBill.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const { resolveXeroInvoiceLineItemAccount } = require('../xero/lib/accountCodeResolver');
const { getXeroInvoiceCurrencyForClientId } = require('../xero/lib/invoiceCurrency');
const sqlPurchase = require('../sqlaccount/wrappers/purchase.wrapper');
const { getTodayMalaysiaDate, utcDatetimeFromDbToMalaysiaDateOnly } = require('../../utils/dateMalaysia');

function parseJson(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

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

/**
 * Get or create supplier contact id in accounting. Reads supplierdetail.account for provider; if missing, syncs and writes back.
 * @param {string} clientId
 * @param {string} provider
 * @param {object} req - from resolveClientAccounting
 * @param {string} supplierdetailId - supplierdetail.id
 * @returns {Promise<{ ok: boolean, contactId?: string, reason?: string }>}
 */
async function getSupplierContactForPurchase(clientId, provider, req, supplierdetailId) {
  if (!supplierdetailId) return { ok: false, reason: 'NO_SUPPLIER' };
  const [rows] = await pool.query(
    'SELECT id, title, email, account FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1',
    [supplierdetailId, clientId]
  );
  if (!rows.length) return { ok: false, reason: 'SUPPLIER_NOT_FOUND' };
  const row = rows[0];
  const account = parseJson(row.account) || [];
  const entry = Array.isArray(account) ? account.find((a) => (a.clientId === clientId || a.client_id === clientId) && (a.system || a.provider || '').toLowerCase() === provider) : null;
  let contactId = entry ? (entry.id || entry.contactId) : null;
  if (contactId) return { ok: true, contactId: String(contactId) };

  const record = {
    name: (row.title || '').trim(),
    fullname: (row.title || '').trim(),
    email: (row.email || '').trim(),
    phone: ''
  };
  const syncRes = await ensureContactInAccounting(clientId, provider, 'supplier', record, null);
  if (!syncRes.ok) return { ok: false, reason: syncRes.reason || 'SUPPLIER_SYNC_FAILED' };
  contactId = syncRes.contactId;

  const merged = Array.isArray(account) ? [...account] : [];
  const filtered = merged.filter((a) => !((a.clientId === clientId || a.client_id === clientId) && (a.system || a.provider || '').toLowerCase() === provider));
  filtered.push({ clientId, provider, id: String(contactId) });
  await pool.query('UPDATE supplierdetail SET account = ?, updated_at = NOW() WHERE id = ? AND client_id = ?', [JSON.stringify(filtered), supplierdetailId, clientId]);
  return { ok: true, contactId: String(contactId) };
}

/**
 * Build purchase line description: property shortname | supplier title | description (max 255).
 */
function buildBillDescription(propertyShortname, supplierTitle, description) {
  const parts = [(propertyShortname || '').trim(), (supplierTitle || '').trim(), (description || '').trim()].filter(Boolean);
  return parts.join(' | ').slice(0, 255) || 'Bill';
}

/**
 * Normalize frontend payment method to key for getPaymentDestinationAccountId.
 * @param {string} method - e.g. "Bank", "Cash", "Bulk"
 */
function normalizePaymentMethod(method) {
  const m = (method || '').toString().trim().toLowerCase();
  if (m === 'bank' || m === 'bank transfer' || m === 'online transfer' || m === 'duitnow' || m === 'fpx') return 'bank';
  if (m === 'cash') return 'cash';
  return 'cash'; // default
}

function toDateOnlyString(input) {
  if (input == null || input === '') return getTodayMalaysiaDate();
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (dateOnly) return dateOnly[1];
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return getTodayMalaysiaDate();
  return utcDatetimeFromDbToMalaysiaDateOnly(d);
}

function parseBukkuPurchaseIdFromBillUrl(url) {
  if (url == null) return null;
  const s = String(url).trim();
  if (!s) return null;
  const m = /\/purchases\/bills\/([^/?#]+)/i.exec(s);
  return m && m[1] ? String(m[1]).trim() : null;
}

function parseXeroInvoiceIdFromRef(ref) {
  const s = ref == null ? '' : String(ref).trim();
  if (!s) return null;
  const directGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (directGuid.test(s)) return s;
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(s);
  return m?.[1] ? m[1] : null;
}

function buildXeroBillOpenUrl(invoiceId) {
  const id = invoiceId != null ? String(invoiceId).trim() : '';
  if (!id) return null;
  return `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${encodeURIComponent(id)}`;
}

function isIgnorableVoidError(err, status) {
  const msg = (typeof err === 'string' ? err : JSON.stringify(err || {})).toLowerCase();
  if (status === 404) return true;
  return /already|already void|already voided|not found|does not exist|invalid status transition/.test(msg);
}

async function resolveBukkuPurchaseId(req, billurl, billname) {
  const fromUrl = parseBukkuPurchaseIdFromBillUrl(billurl);
  if (fromUrl) return fromUrl;
  const number = billname != null ? String(billname).trim() : '';
  if (!number) return null;
  const listRes = await bukkuPurchaseBill.listpurchasebills(req, { search: number, page_size: 20 });
  if (!listRes?.ok) return null;
  const list = listRes?.data?.transactions || listRes?.data?.data || listRes?.data?.items || [];
  for (const tx of Array.isArray(list) ? list : []) {
    if (String(tx?.number || '').trim() === number && tx?.id != null) {
      return String(tx.id).trim();
    }
  }
  return null;
}

/**
 * Expenses purchase line account:
 * per business rule, always use Platform Collection mapping.
 */
async function resolveExpenseAccountMapping(clientId, provider) {
  const platformCollectionUuid = await getAccountIdByPaymentType('platform_collection');
  if (!platformCollectionUuid) return null;
  return getAccountMapping(clientId, platformCollectionUuid, provider);
}

/**
 * Create one cash purchase for a single bill. DR = expense account, CR = payment method.
 */
async function createCashPurchaseForOneBill(clientId, req, provider, bill, opts) {
  const paidAt = opts.paidAt instanceof Date ? opts.paidAt : new Date(opts.paidAt);
  const paidDate = toDateOnlyString(opts.paidAt);
  const paymentMethod = normalizePaymentMethod(opts.paymentMethod);

  const contactRes = await getSupplierContactForPurchase(clientId, provider, req, bill.supplierdetail_id);
  if (!contactRes.ok) return { ok: false, reason: contactRes.reason };
  const contactId = contactRes.contactId;

  const expenseMapping = await resolveExpenseAccountMapping(clientId, provider);
  if (!expenseMapping || !expenseMapping.accountId) return { ok: false, reason: 'No expense account mapping for client' };

  const paymentDest = await getPaymentDestinationAccountId(clientId, provider, paymentMethod);
  if (!paymentDest || !paymentDest.accountId) return { ok: false, reason: `No ${paymentMethod} account (account table + account_client)` };

  const amount = Number(bill.amount) || 0;
  if (amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const description = buildBillDescription(bill.property_shortname, bill.supplier_title, bill.description);

  if (provider === 'bukku') {
    let currencyCode;
    try {
      currencyCode = await getClientCurrencyCode(clientId);
    } catch (e) {
      return { ok: false, reason: 'MISSING_CLIENT_CURRENCY' };
    }
    const formItem = {
      account_id: Number(expenseMapping.accountId),
      description,
      unit_price: amount,
      quantity: 1
    };
    const payload = {
      payment_mode: 'cash',
      contact_id: Number(contactId),
      date: paidDate,
      currency_code: currencyCode,
      exchange_rate: 1,
      tax_mode: 'exclusive',
      description: description.slice(0, 255),
      form_items: [formItem],
      deposit_items: [{ account_id: Number(paymentDest.accountId), amount }],
      status: 'ready'
    };
    const res = await bukkuPurchaseBill.createpurchasebill(req, payload);
    if (!res?.ok) {
      return { ok: false, reason: res?.error || 'BUKKU_CREATE_PURCHASE_BILL_FAILED' };
    }
    const tx = res?.data?.transaction && typeof res.data.transaction === 'object'
      ? res.data.transaction
      : (res?.data && typeof res.data === 'object' ? res.data : null);
    const id = tx?.id ?? res?.data?.id ?? res?.id;
    const sub = req?.client?.bukku_subdomain ? String(req.client.bukku_subdomain).trim() : '';
    const shortLink = tx?.short_link != null && String(tx.short_link).trim() !== '' ? String(tx.short_link).trim() : null;
    const purchaseUrl = shortLink || (sub && id != null ? `https://${sub}.bukku.my/purchases/bills/${id}` : null);
    const purchaseNumber = tx?.number != null && String(tx.number).trim() !== '' ? String(tx.number).trim() : null;
    return {
      ok: true,
      purchaseId: id != null ? String(id) : undefined,
      purchaseUrl: purchaseUrl || undefined,
      purchaseNumber: purchaseNumber || undefined
    };
  }

  if (provider === 'xero' || provider === 'autocount') {
    const purchaseRes = await createCashPurchaseOne(req, provider, {
      contactId,
      expenseAccountId: expenseMapping.accountId,
      paymentAccountId: paymentDest.accountId,
      amount,
      date: paidAt,
      description
    });
    return purchaseRes;
  }

  if (provider === 'sql') {
    const purchaseRes = await createCashPurchaseOne(req, provider, {
      contactId,
      expenseAccountId: expenseMapping.accountId,
      paymentAccountId: paymentDest.accountId,
      amount,
      date: paidAt,
      description
    });
    return purchaseRes;
  }

  return { ok: false, reason: `Purchase not yet implemented for ${provider}` };
}

/**
 * Create one cash purchase (DR expense account, CR payment account) with contact. Used by expenses (supplier) and generatereport (owner payout).
 * All account ids are accounting-system ids (e.g. Bukku numeric account_id).
 * @param {object} req - from resolveClientAccounting
 * @param {string} provider - 'bukku'|...
 * @param {{ contactId: string|number, expenseAccountId: string|number, paymentAccountId: string|number, amount: number, date: Date|string, description: string }} opts
 * @returns {Promise<{ ok: boolean, purchaseId?: string, reason?: string }>}
 */
async function createCashPurchaseOne(req, provider, opts) {
  const { contactId, expenseAccountId, paymentAccountId, amount, date, description, productId } = opts || {};
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const dateStr = toDateOnlyString(date);
  const desc = (description || 'Payment').toString().trim().slice(0, 255);

  if (provider === 'bukku') {
    const formItem = { account_id: Number(expenseAccountId), description: desc, unit_price: amt, quantity: 1 };
    if (productId) formItem.product_id = Number(productId);
    const currencyCode = await getClientCurrencyCode(req?.client?.id);
    const payload = {
      payment_mode: 'cash',
      contact_id: Number(contactId),
      date: dateStr,
      currency_code: currencyCode,
      exchange_rate: 1,
      tax_mode: 'exclusive',
      description: desc,
      form_items: [formItem],
      deposit_items: [{ account_id: Number(paymentAccountId), amount: amt }],
      status: 'ready'
    };
    console.log('[bukku/purchase-bill] create payload', {
      clientId: req?.client?.id || null,
      contactId: Number(contactId),
      date: dateStr,
      debitAccountId: Number(expenseAccountId),
      creditAccountId: Number(paymentAccountId),
      amount: amt
    });
    const res = await bukkuPurchaseBill.createpurchasebill(req, payload);
    if (!res?.ok) {
      const reason = formatProviderError(res?.error) || 'BUKKU_CREATE_PURCHASE_BILL_FAILED';
      console.warn('[bukku/purchase-bill] create failed', { clientId: req?.client?.id || null, reason });
      return { ok: false, reason };
    }
    const tx = res?.data?.transaction && typeof res.data.transaction === 'object'
      ? res.data.transaction
      : (res?.data && typeof res.data === 'object' ? res.data : null);
    const id = tx?.id ?? res?.data?.id ?? res?.id;
    const sub = req?.client?.bukku_subdomain ? String(req.client.bukku_subdomain).trim() : '';
    const shortLink = tx?.short_link != null && String(tx.short_link).trim() !== '' ? String(tx.short_link).trim() : null;
    const purchaseUrl = shortLink || (sub && id != null ? `https://${sub}.bukku.my/purchases/bills/${id}` : null);
    const purchaseNumber = tx?.number != null && String(tx.number).trim() !== '' ? String(tx.number).trim() : null;
    return {
      ok: true,
      purchaseId: id != null ? String(id) : undefined,
      purchaseUrl: purchaseUrl || undefined,
      purchaseNumber: purchaseNumber || undefined
    };
  }

  if (provider === 'xero') {
    const expenseLine = await resolveXeroInvoiceLineItemAccount(req, expenseAccountId);
    if (!expenseLine) return { ok: false, reason: 'XERO_EXPENSE_ACCOUNT_CODE_REQUIRED' };
    const payAccount = await buildXeroPaymentAccountForReceipt(req, paymentAccountId);
    if (!payAccount) return { ok: false, reason: 'XERO_PAYMENT_ACCOUNT_CODE_REQUIRED' };
    const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
    const invoiceCurrency = await getXeroInvoiceCurrencyForClientId(req?.client?.id);
    const invPayload = {
      Type: 'ACCPAY',
      Contact,
      CurrencyCode: invoiceCurrency,
      Date: dateStr,
      DueDate: dateStr,
      LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, ...expenseLine }],
      Status: 'AUTHORISED'
    };
    const res = await xeroInvoice.create(req, invPayload);
    const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
    const invoiceId = inv?.InvoiceID ?? inv?.InvoiceId;
    const invoiceNumber = inv?.InvoiceNumber ?? inv?.InvoiceNo;
    if (!invoiceId) return { ok: false, reason: res?.error || 'XERO_CREATE_BILL_FAILED' };
    try {
      const payRes = await xeroPayment.createPayment(req, {
        Invoice: { InvoiceID: invoiceId },
        Account: payAccount,
        Date: dateStr,
        Amount: amt,
        Reference: desc.slice(0, 255)
      });
      if (!payRes?.ok) {
        return {
          ok: false,
          reason: formatProviderError(payRes?.error) || 'XERO_PAYMENT_FAILED'
        };
      }
    } catch (payErr) {
      return { ok: false, reason: payErr?.response?.data?.Message || payErr?.message || 'XERO_PAYMENT_FAILED' };
    }
    return {
      ok: true,
      purchaseId: String(invoiceId),
      purchaseNumber: invoiceNumber ? String(invoiceNumber) : undefined,
      purchaseUrl: buildXeroBillOpenUrl(invoiceId) || undefined
    };
  }

  if (provider === 'autocount') {
    const autocountPurchase = require('../autocount/wrappers/purchase.wrapper');
    const payload = {
      master: { docDate: dateStr, creditorCode: String(contactId), creditorName: desc },
      details: [{ productCode: (productId && String(productId)) || 'GENERAL', description: desc, qty: 1, unitPrice: amt }]
    };
    try {
      const res = await autocountPurchase.createPurchase(req, payload);
      const docNo = res?.data?.docNo ?? res?.data?.DocNo ?? res?.data?.master?.docNo ?? res?.docNo;
      if (!docNo) return { ok: false, reason: res?.error || res?.message || 'AUTOCOUNT_CREATE_PURCHASE_FAILED' };
      return { ok: true, purchaseId: String(docNo) };
    } catch (e) {
      return { ok: false, reason: e?.response?.data?.message || e?.message || 'AUTOCOUNT_PURCHASE_FAILED' };
    }
  }

  if (provider === 'sql') {
    const payload = {
      ContactId: String(contactId),
      Date: dateStr,
      Amount: amt,
      Description: desc,
      AccountCode: String(expenseAccountId),
      PaymentAccountCode: String(paymentAccountId)
    };
    const res = await sqlPurchase.createPurchase(req, payload);
    const id = res?.data?.id ?? res?.data?.Id ?? res?.data?.DocNo ?? res?.id;
    if (!id) return { ok: false, reason: res?.error || 'SQL_CREATE_PURCHASE_FAILED' };
    return { ok: true, purchaseId: String(id) };
  }

  return { ok: false, reason: `Purchase not yet implemented for ${provider}` };
}

/**
 * Create cash purchase (bills) in accounting when client marks bills as paid. Uses #datepickerpayment and #dropdownpaymentmethod.
 * On failure writes to help ticket (recordAccountingError).
 * @param {string} clientId
 * @param {string[]} billIds - bills.id
 * @param {{ paidAt: Date|string, paymentMethod: string }} opts - paidAt from #datepickerpayment, paymentMethod from #dropdownpaymentmethod (Bank/Cash)
 * @returns {Promise<{ ok: boolean, created: number, errors?: string[] }>}
 */
async function createPurchaseForBills(clientId, billIds, opts) {
  if (!clientId || !Array.isArray(billIds) || billIds.length === 0) {
    return { ok: true, created: 0 };
  }

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    console.log('[expenses/accounting] skip createPurchaseForBills: no accounting integration for client', clientId);
    return { ok: true, created: 0 }; // no accounting = skip, no ticket
  }
  const { provider, req } = resolved;

  const placeholders = billIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT b.id, b.amount, b.period, b.description,
            b.supplierdetail_id AS supplierdetail_id,
            p.shortname AS property_shortname,
            s.title AS supplier_title
     FROM bills b
     LEFT JOIN propertydetail p ON p.id = b.property_id AND p.client_id = b.client_id
     LEFT JOIN supplierdetail s ON s.id = b.supplierdetail_id
     WHERE b.client_id = ? AND b.id IN (${placeholders})`,
    [clientId, ...billIds]
  );
  console.log('[expenses/accounting] createPurchaseForBills start', {
    clientId,
    provider,
    requested: billIds.length,
    found: rows.length
  });

  let created = 0;
  const errors = [];
  for (const row of rows) {
    try {
      const bill = {
        id: row.id,
        amount: row.amount,
        period: row.period,
        description: row.description,
        property_shortname: row.property_shortname,
        supplier_title: row.supplier_title,
        supplierdetail_id: row.supplierdetail_id
      };
      const result = await createCashPurchaseForOneBill(clientId, req, provider, bill, opts);
      if (result.ok) {
        created++;
        if (result.purchaseUrl || result.purchaseNumber || (provider === 'xero' && result.purchaseId)) {
          await pool.query(
            `UPDATE bills
                SET billurl = COALESCE(?, billurl),
                    billname = COALESCE(?, billname),
                    updated_at = NOW()
              WHERE id = ? AND client_id = ?`,
            [
              result.purchaseUrl
                || (provider === 'xero' ? buildXeroBillOpenUrl(result.purchaseId) : null)
                || (provider === 'xero' ? String(result.purchaseId || '') : null)
                || null,
              result.purchaseNumber || null,
              row.id,
              clientId
            ]
          );
        }
      }
      else errors.push(`${row.id}: ${result.reason}`);
    } catch (err) {
      errors.push(`${row.id}: ${err.message || 'CREATE_FAILED'}`);
    }
  }

  if (errors.length > 0) {
    console.warn('[expenses/accounting] createPurchaseForBills errors', {
      clientId,
      provider,
      created,
      total: rows.length,
      errors
    });
    recordAccountingError(clientId, {
      context: 'expenses_purchase',
      reason: errors.join('; '),
      ids: billIds,
      provider
    }).catch(() => {});
  }

  console.log('[expenses/accounting] createPurchaseForBills done', {
    clientId,
    provider,
    created,
    total: rows.length
  });

  return { ok: true, created, errors: errors.length ? errors : undefined };
}

/**
 * Void accounting purchase bills before deleting local bills.
 * Ignore when no accounting integration, no stored purchase reference, or already void/not found.
 */
async function voidPurchaseForBills(clientId, billIds) {
  if (!clientId || !Array.isArray(billIds) || billIds.length === 0) {
    return { ok: true, voided: 0, errors: [], fatalErrors: [] };
  }
  const placeholders = billIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, billurl, billname
       FROM bills
      WHERE client_id = ? AND id IN (${placeholders})`,
    [clientId, ...billIds]
  );
  if (!rows.length) return { ok: true, voided: 0, errors: [], fatalErrors: [] };

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return { ok: true, voided: 0, errors: [], fatalErrors: [] };
  }
  const { provider, req } = resolved;

  let voided = 0;
  const errors = [];
  const fatalErrors = [];

  for (const row of rows) {
    try {
      let purchaseId = null;
      if (provider === 'bukku') {
        purchaseId = await resolveBukkuPurchaseId(req, row.billurl, row.billname);
      } else if (provider === 'xero') {
        purchaseId = parseXeroInvoiceIdFromRef(row.billurl) || parseXeroInvoiceIdFromRef(row.billname);
      } else {
        continue;
      }
      if (!purchaseId) continue;
      let r;
      if (provider === 'bukku') {
        r = await bukkuPurchaseBill.updatepurchasebillstatus(req, purchaseId, {
          status: 'void',
          void_reason: 'Deleted from operator expenses'
        });
      } else {
        // Xero AP bill: if already paid, reverse related payment(s) before void.
        r = await xeroInvoice.update(req, purchaseId, { Status: 'VOIDED' });
        if (!r?.ok) {
          const errText = formatProviderError(r?.error);
          if (/payment|paid|cannot be voided|validation/i.test(errText)) {
            const where = `Invoice.InvoiceID=guid("${purchaseId}")`;
            const listRes = await xeroPayment.listPayments(req, { where });
            if (!listRes?.ok) {
              throw new Error(`List payment for ${purchaseId} failed: ${formatProviderError(listRes?.error)}`);
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
            r = await xeroInvoice.update(req, purchaseId, { Status: 'VOIDED' });
          }
        }
      }
      if (r?.ok) {
        voided++;
        continue;
      }
      if (isIgnorableVoidError(r?.error, r?.status)) {
        errors.push(`${row.id}: already void/not found`);
        continue;
      }
      fatalErrors.push(`${row.id}: ${JSON.stringify(r?.error || `${provider.toUpperCase()}_VOID_FAILED`)}`);
    } catch (e) {
      const msg = e?.message || String(e);
      if (isIgnorableVoidError(msg)) {
        errors.push(`${row.id}: already void/not found`);
      } else {
        fatalErrors.push(`${row.id}: ${msg}`);
      }
    }
  }
  return { ok: fatalErrors.length === 0, voided, errors, fatalErrors };
}

module.exports = {
  createPurchaseForBills,
  createCashPurchaseOne,
  voidPurchaseForBills,
  getSupplierContactForPurchase,
  buildBillDescription,
  normalizePaymentMethod,
  resolveExpenseAccountMapping
};
