/**
 * Sandbox / backfill: RentalCollection isPaid=1 but receipturl empty.
 * Backfill receipturl from Bukku: either GET invoice payments[0].short_link or create payment and use transaction.short_link.
 * Uses paidAt for payment date when creating.
 */

const pool = require('../../config/db');
const { getAccessContextByEmail } = require('../access/access.service');
const {
  resolveClientAccounting,
  getContactForRentalItem,
  getPaymentDestinationAccountId,
  isCashInvoiceToPropertyOwner,
  getClientCurrencyCode
} = require('../rentalcollection-invoice/rentalcollection-invoice.service');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const bukkuPayment = require('../bukku/wrappers/payment.wrapper');

/**
 * Find RentalCollection rows: client_id, ispaid=1, (receipturl IS NULL or ''), invoiceid present. Optionally paidat present.
 * @param {string} clientId
 * @returns {Promise<Array<{ id, client_id, invoiceid, bukku_invoice_id, amount, paidat, referenceid, property_id, tenant_id, type_id }>>}
 */
async function findPaidWithoutReceiptUrl(clientId) {
  const [rows] = await pool.query(
    `SELECT id, client_id, invoiceid, bukku_invoice_id, amount, paidat, referenceid, property_id, tenant_id, type_id
     FROM rentalcollection
     WHERE client_id = ? AND ispaid = 1
       AND (receipturl IS NULL OR TRIM(COALESCE(receipturl,'')) = '')
       AND invoiceid IS NOT NULL AND TRIM(COALESCE(invoiceid,'')) != ''`,
    [clientId]
  );
  return rows || [];
}

/**
 * Get receipt short_link from Bukku: 1) GET invoice and use payments[0].short_link; 2) or create payment and use response transaction.short_link.
 * @param {object} req - req.client with bukku credentials
 * @param {{ id, invoiceid, amount, paidat, referenceid, property_id, tenant_id, type_id }} row - rentalcollection row
 * @param {string} clientId
 * @param {string} provider - 'bukku'
 * @returns {Promise<{ ok: boolean, shortLink?: string, reason?: string }>}
 */
async function getOrCreateReceiptLink(req, row, clientId, provider) {
  const invoiceId = String(row.invoiceid || '').trim();
  if (!invoiceId) return { ok: false, reason: 'NO_INVOICE_ID' };

  // 1) Try GET invoice and use existing payment's short_link
  const readRes = await bukkuInvoice.readinvoice(req, invoiceId);
  if (readRes.ok && readRes.data) {
    const payments = readRes.data.payments || readRes.data.payment || [];
    const firstPayment = Array.isArray(payments) ? payments[0] : payments;
    const shortLink = firstPayment?.short_link || firstPayment?.short_link_url;
    if (shortLink) {
      return { ok: true, shortLink };
    }
  }

  // 2) Create payment and get transaction.short_link from response
  const dest = await getPaymentDestinationAccountId(clientId, 'bukku', 'bank');
  const bankAccountId = dest ? dest.accountId : '';
  if (!bankAccountId) {
    return { ok: false, reason: 'NO_BUKKU_BANK_ACCOUNT' };
  }
  const invoiceToOwner = await isCashInvoiceToPropertyOwner(row.type_id);
  const contactRes = await getContactForRentalItem(clientId, provider, req, {
    invoiceToOwner,
    propertyId: row.property_id || null,
    tenantId: row.tenant_id
  });
  if (!contactRes.ok) {
    return { ok: false, reason: `contact ${contactRes.reason}` };
  }
  const paidat = row.paidat ? (row.paidat instanceof Date ? row.paidat : new Date(row.paidat)) : new Date();
  const reference = (row.referenceid || 'Backfill').toString().trim().slice(0, 50) || `RC-${row.id}`;
  const amount = Number(row.amount) || 0;
  if (amount <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };

  let currencyCode;
  try {
    currencyCode = await getClientCurrencyCode(clientId);
  } catch (e) {
    return { ok: false, reason: 'MISSING_CLIENT_CURRENCY' };
  }

  const payload = {
    contact_id: Number(contactRes.contactId),
    number: reference,
    date: new Date(paidat).toISOString(),
    currency_code: currencyCode,
    exchange_rate: 1,
    amount,
    link_items: [{ target_transaction_id: Number(invoiceId), apply_amount: amount }],
    deposit_items: [{ account_id: Number(bankAccountId), amount }],
    status: 'ready'
  };

  const createRes = await bukkuPayment.createPayment(req, payload);
  if (!createRes.ok) {
    const errMsg = createRes.error?.message || (typeof createRes.error === 'string' ? createRes.error : JSON.stringify(createRes.error));
    return { ok: false, reason: errMsg || 'CREATE_PAYMENT_FAILED' };
  }
  const shortLink = createRes.data?.transaction?.short_link || createRes.data?.short_link || null;
  if (shortLink) return { ok: true, shortLink };
  return { ok: false, reason: 'NO_SHORT_LINK_IN_RESPONSE' };
}

/**
 * Backfill receipturl for all RentalCollection where isPaid=1 and receipturl is empty.
 * @param {string} clientId
 * @returns {Promise<{ ok: boolean, total: number, success: number, failed: number, items: Array<{ id: string, status: 'ok'|'fail', receipturl?: string, reason?: string }> }>}
 */
async function backfillReceiptUrl(clientId) {
  const items = [];
  let success = 0;
  let failed = 0;

  const rows = await findPaidWithoutReceiptUrl(clientId);
  const total = rows.length;
  if (total === 0) {
    return { ok: true, total: 0, success: 0, failed: 0, items: [] };
  }

  const resolved = await resolveClientAccounting(clientId);
  if (!resolved.ok || !resolved.req) {
    return {
      ok: false,
      total,
      success: 0,
      failed: total,
      items: rows.map((r) => ({ id: r.id, status: 'fail', reason: resolved.reason || 'NO_ACCOUNTING' }))
    };
  }
  const { provider, req } = resolved;
  if (provider !== 'bukku') {
    return {
      ok: false,
      total,
      success: 0,
      failed: total,
      items: rows.map((r) => ({ id: r.id, status: 'fail', reason: `Unsupported provider: ${provider}` }))
    };
  }

  for (const row of rows) {
    try {
      const linkRes = await getOrCreateReceiptLink(req, row, clientId, provider);
      if (!linkRes.ok) {
        failed++;
        items.push({ id: row.id, status: 'fail', reason: linkRes.reason });
        continue;
      }
      await pool.query(
        'UPDATE rentalcollection SET receipturl = ? WHERE id = ?',
        [linkRes.shortLink, row.id]
      );
      success++;
      items.push({ id: row.id, status: 'ok', receipturl: linkRes.shortLink });
    } catch (err) {
      failed++;
      items.push({ id: row.id, status: 'fail', reason: err?.message || 'exception' });
    }
  }

  return { ok: true, total, success, failed, items };
}

module.exports = {
  findPaidWithoutReceiptUrl,
  backfillReceiptUrl
};
