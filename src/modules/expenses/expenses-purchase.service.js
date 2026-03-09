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
  getAccountIdByPaymentType
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const { ensureContactInAccounting } = require('../contact/contact-sync.service');
const { recordAccountingError } = require('../help/help.service');
const bukkuPurchaseBill = require('../bukku/wrappers/purchaseBill.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const xeroPayment = require('../xero/wrappers/payment.wrapper');
const sqlPurchase = require('../sqlaccount/wrappers/purchase.wrapper');

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
    'SELECT id, title, email, account, productid FROM supplierdetail WHERE id = ? AND client_id = ? LIMIT 1',
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
  if (m === 'bank') return 'bank';
  if (m === 'cash') return 'cash';
  return 'cash'; // default
}

/**
 * Create one cash purchase for a single bill. DR = expense account (optional product from supplierdetail.productid), CR = payment method.
 * Product is optional: if supplierdetail has productid use it; else skip (not compulsory).
 */
async function createCashPurchaseForOneBill(clientId, req, provider, bill, opts) {
  const paidAt = opts.paidAt instanceof Date ? opts.paidAt : new Date(opts.paidAt);
  const dateStr = paidAt.toISOString ? paidAt.toISOString().slice(0, 10) : '';
  const paymentMethod = normalizePaymentMethod(opts.paymentMethod);

  const contactRes = await getSupplierContactForPurchase(clientId, provider, req, bill.supplierdetail_id);
  if (!contactRes.ok) return { ok: false, reason: contactRes.reason };
  const contactId = contactRes.contactId;

  const expenseAccountUuid = await getAccountIdByPaymentType('expense');
  if (!expenseAccountUuid) return { ok: false, reason: 'No Expenses account (account table title Expenses/expense)' };
  const expenseMapping = await getAccountMapping(clientId, expenseAccountUuid, provider);
  if (!expenseMapping || !expenseMapping.accountId) return { ok: false, reason: 'No expense account mapping for client' };

  const paymentDest = await getPaymentDestinationAccountId(clientId, provider, paymentMethod);
  if (!paymentDest || !paymentDest.accountId) return { ok: false, reason: `No ${paymentMethod} account (account table + account_client)` };

  const amount = Number(bill.amount) || 0;
  if (amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };
  const description = buildBillDescription(bill.property_shortname, bill.supplier_title, bill.description);
  const productId = bill.supplier_productid != null && String(bill.supplier_productid).trim() !== '' ? String(bill.supplier_productid).trim() : null;

  if (provider === 'bukku') {
    const formItem = {
      account_id: Number(expenseMapping.accountId),
      description,
      unit_price: amount,
      quantity: 1
    };
    if (productId) formItem.product_id = Number(productId);
    const payload = {
      payment_mode: 'cash',
      contact_id: Number(contactId),
      date: paidAt.toISOString ? paidAt.toISOString() : new Date().toISOString(),
      currency_code: 'MYR',
      exchange_rate: 1,
      tax_mode: 'exclusive',
      description: description.slice(0, 255),
      form_items: [formItem],
      deposit_items: [{ account_id: Number(paymentDest.accountId), amount }],
      status: 'ready'
    };
    const res = await bukkuPurchaseBill.createpurchasebill(req, payload);
    const id = res?.data?.id ?? res?.id;
    return { ok: true, purchaseId: id != null ? String(id) : undefined };
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
      description,
      productId
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
  const dateVal = date != null ? (date instanceof Date ? date : new Date(date)) : new Date();
  const dateStr = dateVal.toISOString ? dateVal.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const dateStrFull = dateVal.toISOString ? dateVal.toISOString() : new Date().toISOString();
  const desc = (description || 'Payment').toString().trim().slice(0, 255);

  if (provider === 'bukku') {
    const formItem = { account_id: Number(expenseAccountId), description: desc, unit_price: amt, quantity: 1 };
    if (productId) formItem.product_id = Number(productId);
    const payload = {
      payment_mode: 'cash',
      contact_id: Number(contactId),
      date: dateStrFull,
      currency_code: 'MYR',
      exchange_rate: 1,
      tax_mode: 'exclusive',
      description: desc,
      form_items: [formItem],
      deposit_items: [{ account_id: Number(paymentAccountId), amount: amt }],
      status: 'ready'
    };
    const res = await bukkuPurchaseBill.createpurchasebill(req, payload);
    const id = res?.data?.id ?? res?.id;
    return { ok: true, purchaseId: id != null ? String(id) : undefined };
  }

  if (provider === 'xero') {
    const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'Contact' };
    const invPayload = {
      Type: 'ACCPAY',
      Contact,
      Date: dateStr,
      DueDate: dateStr,
      LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, AccountCode: String(expenseAccountId) }],
      Status: 'AUTHORISED'
    };
    const res = await xeroInvoice.create(req, invPayload);
    const inv = res?.data?.Invoices?.[0] ?? res?.Invoices?.[0];
    const invoiceId = inv?.InvoiceID ?? inv?.InvoiceId;
    if (!invoiceId) return { ok: false, reason: res?.error || 'XERO_CREATE_BILL_FAILED' };
    try {
      await xeroPayment.createPayment(req, {
        Invoice: { InvoiceID: invoiceId },
        Account: { Code: String(paymentAccountId) },
        Date: dateStr,
        Amount: amt,
        Reference: desc.slice(0, 255)
      });
    } catch (payErr) {
      return { ok: false, reason: payErr?.response?.data?.Message || payErr?.message || 'XERO_PAYMENT_FAILED' };
    }
    return { ok: true, purchaseId: String(invoiceId) };
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
    return { ok: true, created: 0 }; // no accounting = skip, no ticket
  }
  const { provider, req } = resolved;

  const placeholders = billIds.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT b.id, b.amount, b.period, b.description,
            COALESCE(b.supplierdetail_id, (SELECT id FROM supplierdetail sd2 WHERE sd2.wix_id = b.billtype_wixid AND sd2.client_id = b.client_id LIMIT 1)) AS supplierdetail_id,
            p.shortname AS property_shortname,
            s.title AS supplier_title,
            s.productid AS supplier_productid
     FROM bills b
     LEFT JOIN propertydetail p ON p.id = b.property_id AND p.client_id = b.client_id
     LEFT JOIN supplierdetail s ON s.id = COALESCE(b.supplierdetail_id, (SELECT id FROM supplierdetail sd3 WHERE sd3.wix_id = b.billtype_wixid AND sd3.client_id = b.client_id LIMIT 1))
     WHERE b.client_id = ? AND b.id IN (${placeholders})`,
    [clientId, ...billIds]
  );

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
        supplierdetail_id: row.supplierdetail_id,
        supplier_productid: row.supplier_productid
      };
      const result = await createCashPurchaseForOneBill(clientId, req, provider, bill, opts);
      if (result.ok) created++;
      else errors.push(`${row.id}: ${result.reason}`);
    } catch (err) {
      errors.push(`${row.id}: ${err.message || 'CREATE_FAILED'}`);
    }
  }

  if (errors.length > 0) {
    recordAccountingError(clientId, {
      context: 'expenses_purchase',
      reason: errors.join('; '),
      ids: billIds,
      provider
    }).catch(() => {});
  }

  return { ok: true, created, errors: errors.length ? errors : undefined };
}

module.exports = {
  createPurchaseForBills,
  createCashPurchaseOne,
  getSupplierContactForPurchase,
  buildBillDescription,
  normalizePaymentMethod
};
