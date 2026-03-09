/**
 * E-Invoice: when client_integration.einvoice = 1 (#checkboxeinvoiceonboard), we must run e-invoice after creating invoice.
 * If customer document is incomplete → use general invoice (开单). 不管怎样都一定要开到单，就算最后没有 submit 到 e-invoice 也要开到单.
 * All four platforms: Bukku, Xero, AutoCount, SQL.
 */

const pool = require('../../config/db');

const bukkuEinvoice = require('../bukku/wrappers/einvoice.wrapper');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const xeroEinvoice = require('../xero/wrappers/einvoice.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const autocountEinvoice = require('../autocount/wrappers/einvoice.wrapper');
const autocountInvoice = require('../autocount/wrappers/invoice.wrapper');
const sqlEinvoice = require('../sqlaccount/wrappers/einvoice.wrapper');
const sqlInvoice = require('../sqlaccount/wrappers/invoice.wrapper');

/**
 * Check if e-invoice is enabled for this client and provider (Company Setting #checkboxeinvoiceonboard).
 * @param {string} clientId
 * @param {string} provider - bukku|xero|autocount|sql
 * @returns {Promise<boolean>}
 */
async function getClientEinvoiceEnabled(clientId, provider) {
  if (!clientId || !provider) return false;
  const [rows] = await pool.query(
    `SELECT einvoice FROM client_integration
     WHERE client_id = ? AND \`key\` IN ('Account', 'addonAccount') AND provider = ? AND enabled = 1 LIMIT 1`,
    [clientId, provider]
  );
  const r = rows[0];
  if (!r) return false;
  return r.einvoice === 1 || r.einvoice === true;
}

/**
 * If client has e-invoice enabled, submit the invoice to e-invoice (MyInvois). Must run when #checkboxeinvoiceonboard = true.
 * On failure (e.g. incomplete customer doc), returns generalSuggested: true so caller can create/send general e-invoice.
 * @param {object} req - Express request (for platform creds)
 * @param {{ provider: string, invoiceIdOrDocNo: string }} opts - provider + invoice id or document number
 * @returns {Promise<{ ok: boolean, submitted?: boolean, reason?: string, generalSuggested?: boolean }>}
 */
async function executeEInvoiceIfEnabled(req, opts) {
  const { provider, invoiceIdOrDocNo } = opts || {};
  if (!req?.client?.id || !provider || !invoiceIdOrDocNo) {
    return { ok: false, reason: 'MISSING_PARAMS' };
  }
  const clientId = req.client.id;
  const enabled = await getClientEinvoiceEnabled(clientId, provider);
  if (!enabled) {
    return { ok: true, submitted: false };
  }

  let res;
  try {
    if (provider === 'bukku') {
      res = await bukkuEinvoice.submitEInvoice(req, invoiceIdOrDocNo);
    } else if (provider === 'xero') {
      res = await xeroEinvoice.submitEInvoice(req, invoiceIdOrDocNo);
    } else if (provider === 'autocount') {
      res = await autocountEinvoice.submitEInvoice(req, invoiceIdOrDocNo);
    } else if (provider === 'sql') {
      res = await sqlEinvoice.submitEInvoice(req, invoiceIdOrDocNo);
    } else {
      return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
    }
  } catch (err) {
    const msg = err?.message || String(err);
    const incomplete = /incomplete|validation|required|document|customer|contact/i.test(msg);
    return {
      ok: false,
      reason: msg,
      generalSuggested: incomplete
    };
  }

  if (!res.ok) {
    const errMsg = res.error?.message || res.reason || (typeof res.error === 'string' ? res.error : 'E_INVOICE_SUBMIT_FAILED');
    const incomplete = /incomplete|validation|required|document|customer|contact/i.test(errMsg);
    return {
      ok: false,
      reason: errMsg,
      generalSuggested: incomplete
    };
  }

  return { ok: true, submitted: true };
}

/**
 * Create a "general" invoice (开单) in the accounting system when customer document is incomplete.
 * Minimal payload: contact + one line + account. Guarantees we 开单 even if e-invoice submit fails later.
 * @param {object} req - Express request (req.client.id for creds)
 * @param {{ provider: string, contactId: string|number, accountId: string|number, productId?: string|number, amount: number, description?: string, currency?: string }} opts
 * @returns {Promise<{ ok: boolean, invoiceIdOrDocNo?: string, reason?: string }>}
 */
async function createGeneralInvoice(req, opts) {
  const { provider, contactId, accountId, productId, amount, description, currency } = opts || {};
  if (!provider || contactId == null || accountId == null || amount == null) {
    return { ok: false, reason: 'MISSING_PROVIDER_OR_CONTACT_OR_ACCOUNT_OR_AMOUNT' };
  }
  const desc = (description || 'General').trim().slice(0, 255);
  const amt = Number(amount) || 0;
  if (amt <= 0) return { ok: false, reason: 'INVALID_AMOUNT' };

  try {
    if (provider === 'bukku') {
      const payload = {
        payment_mode: 'cash',
        contact_id: Number(contactId),
        date: new Date().toISOString().slice(0, 10),
        currency_code: (currency || 'MYR').toUpperCase().slice(0, 3),
        exchange_rate: 1,
        tax_mode: 'exclusive',
        form_items: [{
          account_id: Number(accountId),
          description: desc,
          unit_price: amt,
          quantity: 1
        }],
        deposit_items: [{ account_id: Number(accountId), amount: amt }],
        status: 'ready'
      };
      if (productId != null) payload.form_items[0].product_id = Number(productId);
      const res = await bukkuInvoice.createinvoice(req, payload);
      const id = res?.data?.id ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'BUKKU_CREATE_FAILED' };
      return { ok: true, invoiceIdOrDocNo: String(id) };
    }

    if (provider === 'xero') {
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'General Customer' };
      const payload = {
        Type: 'ACCREC',
        Contact,
        Date: new Date().toISOString().slice(0, 10),
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
      return { ok: true, invoiceIdOrDocNo: id };
    }

    if (provider === 'autocount') {
      const docDate = new Date().toISOString().slice(0, 10);
      const payload = {
        master: {
          docDate,
          debtorCode: String(contactId),
          debtorName: desc
        },
        details: [{
          productCode: productId != null ? String(productId) : 'GENERAL',
          description: desc,
          qty: 1,
          unitPrice: amt
        }]
      };
      const res = await autocountInvoice.createInvoice(req, payload);
      const docNo = res?.data?.docNo ?? res?.data?.DocNo ?? res?.docNo;
      if (!docNo) return { ok: false, reason: res?.error || 'AUTOCOUNT_CREATE_FAILED' };
      return { ok: true, invoiceIdOrDocNo: String(docNo) };
    }

    if (provider === 'sql') {
      const payload = {
        contactId: String(contactId),
        accountId: String(accountId),
        amount: amt,
        description: desc,
        date: new Date().toISOString().slice(0, 10)
      };
      const res = await sqlInvoice.createInvoice(req, payload);
      const id = res?.data?.id ?? res?.data?.Id ?? res?.data?.DocNo ?? res?.id;
      if (!id) return { ok: false, reason: res?.error || 'SQL_CREATE_FAILED' };
      return { ok: true, invoiceIdOrDocNo: String(id) };
    }

    return { ok: false, reason: 'UNSUPPORTED_PROVIDER' };
  } catch (err) {
    return { ok: false, reason: err?.message || 'CREATE_GENERAL_INVOICE_FAILED' };
  }
}

/**
 * Ensure we 开单 and run e-invoice when enabled. 如果资料不齐就调用 general invoice；不管怎样都一定要开到单，就算最后没有 submit 到 e-invoice 也要开到单.
 * 1) If existingInvoiceIdOrDocNo: try submit e-invoice; if fail with generalSuggested → create general invoice (开单), then try submit.
 * 2) If no existing invoice: create general invoice (开单), then try submit.
 * @param {object} req
 * @param {{ provider: string, existingInvoiceIdOrDocNo?: string, contactId?: string|number, accountId?: string|number, productId?: string|number, amount?: number, description?: string }} opts
 * @returns {Promise<{ ok: boolean, invoiceIdOrDocNo: string, submitted?: boolean, createdGeneral?: boolean, reason?: string }>}
 */
async function ensureInvoiceCreatedThenEInvoice(req, opts) {
  const { provider, existingInvoiceIdOrDocNo, contactId, accountId, productId, amount, description } = opts || {};
  if (!req?.client?.id || !provider) {
    return { ok: false, reason: 'MISSING_PARAMS', invoiceIdOrDocNo: '' };
  }
  const clientId = req.client.id;
  const enabled = await getClientEinvoiceEnabled(clientId, provider);

  const out = { ok: true, invoiceIdOrDocNo: existingInvoiceIdOrDocNo || '', submitted: false, createdGeneral: false };

  if (existingInvoiceIdOrDocNo && !enabled) {
    return out;
  }

  if (existingInvoiceIdOrDocNo && enabled) {
    const submitResult = await executeEInvoiceIfEnabled(req, { provider, invoiceIdOrDocNo: existingInvoiceIdOrDocNo });
    if (submitResult.submitted) {
      out.submitted = true;
      return out;
    }
    if (!submitResult.generalSuggested) {
      out.reason = submitResult.reason;
      return out;
    }
  }

  if (contactId != null && accountId != null && amount != null) {
    const general = await createGeneralInvoice(req, {
      provider,
      contactId,
      accountId,
      productId,
      amount,
      description: description || 'General'
    });
    if (!general.ok) {
      return { ok: false, invoiceIdOrDocNo: existingInvoiceIdOrDocNo || '', reason: general.reason, createdGeneral: false };
    }
    out.invoiceIdOrDocNo = general.invoiceIdOrDocNo;
    out.createdGeneral = true;
    if (enabled) {
      const submitResult = await executeEInvoiceIfEnabled(req, { provider, invoiceIdOrDocNo: general.invoiceIdOrDocNo });
      if (submitResult.submitted) out.submitted = true;
      else if (submitResult.reason) out.reason = submitResult.reason;
    }
    return out;
  }

  // Already 开单 with existing invoice; e-invoice may have failed or suggested general
  if (existingInvoiceIdOrDocNo) {
    out.invoiceIdOrDocNo = existingInvoiceIdOrDocNo;
    return out;
  }

  return { ok: false, invoiceIdOrDocNo: '', reason: 'NEED_GENERAL_OPTS_OR_EXISTING_INVOICE' };
}

/**
 * @deprecated Use createGeneralInvoice + executeEInvoiceIfEnabled. buildAndSubmitGeneralEInvoice kept for compatibility.
 */
async function buildAndSubmitGeneralEInvoice(req, opts) {
  const created = await createGeneralInvoice(req, opts);
  if (!created.ok) return created;
  const submitResult = await executeEInvoiceIfEnabled(req, { provider: opts.provider, invoiceIdOrDocNo: created.invoiceIdOrDocNo });
  return {
    ok: true,
    invoiceIdOrDocNo: created.invoiceIdOrDocNo,
    submitted: !!submitResult.submitted,
    reason: submitResult.reason
  };
}

/** Default reason for e-invoice cancel when tenancy is extended, changed or booking cancelled (MyInvois often requires reason). */
const EINVOICE_CANCEL_REASON_DEFAULT = 'Extend/Cancel';

/**
 * Cancel e-invoice (MyInvois) for an invoice if client has e-invoice enabled.
 * Call before voiding the invoice in accounting so LHDN is updated.
 * Most e-invoice cancel APIs require a reason; we pass opts.reason (default "Extend/Cancel").
 * @param {object} req - req.client.id for client
 * @param {{ provider: string, invoiceIdOrDocNo: string, reason?: string }} opts
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, reason?: string }>}
 */
async function cancelEInvoiceIfEnabled(req, opts) {
  const { provider, invoiceIdOrDocNo, reason } = opts || {};
  if (!req?.client?.id || !provider || !invoiceIdOrDocNo) {
    return { ok: true, cancelled: false };
  }
  const clientId = req.client.id;
  const enabled = await getClientEinvoiceEnabled(clientId, provider);
  if (!enabled) {
    return { ok: true, cancelled: false };
  }
  const cancelReason = (reason && String(reason).trim()) || EINVOICE_CANCEL_REASON_DEFAULT;
  const bodyByProvider = {
    bukku: { reason: cancelReason },
    xero: { reason: cancelReason },
    autocount: { EInvoiceCancelReason: cancelReason },
    sql: { reason: cancelReason }
  };
  const body = bodyByProvider[provider] || { reason: cancelReason };
  try {
    let res;
    if (provider === 'bukku') {
      res = await bukkuEinvoice.cancelEInvoice(req, invoiceIdOrDocNo, body);
    } else if (provider === 'xero') {
      res = await xeroEinvoice.cancelEInvoice(req, invoiceIdOrDocNo, body);
    } else if (provider === 'autocount') {
      res = await autocountEinvoice.cancelEInvoice(req, invoiceIdOrDocNo, body);
    } else if (provider === 'sql') {
      res = await sqlEinvoice.cancelEInvoice(req, invoiceIdOrDocNo, body);
    } else {
      return { ok: true, cancelled: false };
    }
    if (!res || !res.ok) {
      return { ok: false, cancelled: false, reason: res?.reason || res?.error?.message || 'E_INVOICE_CANCEL_FAILED' };
    }
    return { ok: true, cancelled: true };
  } catch (err) {
    return { ok: false, cancelled: false, reason: err?.message || String(err) };
  }
}

module.exports = {
  getClientEinvoiceEnabled,
  executeEInvoiceIfEnabled,
  createGeneralInvoice,
  ensureInvoiceCreatedThenEInvoice,
  buildAndSubmitGeneralEInvoice,
  cancelEInvoiceIfEnabled,
  EINVOICE_CANCEL_REASON_DEFAULT
};
