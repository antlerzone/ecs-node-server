/**
 * E-Invoice: client_integration.einvoice = 1 (#checkboxeinvoiceonboard) enables MyInvois flows.
 * Bukku sales invoices: resolveBukkuCreateInvoiceMyInvoisAction — only set myinvois_action when e-invoice is on
 * AND GET /contacts/:id has is_myinvois_ready; else plain sales invoice (still 开单).
 * Other platforms: submit/cancel helpers below. 不管怎样都一定要开到单.
 */

const pool = require('../../config/db');

const bukkuContact = require('../bukku/wrappers/contact.wrapper');
const bukkuEinvoice = require('../bukku/wrappers/einvoice.wrapper');
const bukkuInvoice = require('../bukku/wrappers/invoice.wrapper');
const xeroEinvoice = require('../xero/wrappers/einvoice.wrapper');
const xeroInvoice = require('../xero/wrappers/invoice.wrapper');
const { resolveXeroAccountCode } = require('../xero/lib/accountCodeResolver');
const { getXeroInvoiceCurrencyForClientId, normalizeIso4217 } = require('../xero/lib/invoiceCurrency');
const autocountEinvoice = require('../autocount/wrappers/einvoice.wrapper');
const autocountInvoice = require('../autocount/wrappers/invoice.wrapper');
const sqlEinvoice = require('../sqlaccount/wrappers/einvoice.wrapper');
const sqlInvoice = require('../sqlaccount/wrappers/invoice.wrapper');
const { getTodayMalaysiaDate } = require('../../utils/dateMalaysia');

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
 * Parse Bukku GET /contacts/:id — MyInvois readiness is on the contact object.
 * @param {{ ok?: boolean, data?: object, error?: unknown }} res - bukkurequest result
 * @returns {{ ok: boolean, ready: boolean, reason?: string }}
 */
function parseBukkuContactMyInvoisReady(res) {
  if (!res || res.ok !== true || res.data == null) {
    const err = res?.error;
    const reason =
      typeof err === 'string'
        ? err
        : err && typeof err === 'object'
          ? JSON.stringify(err).slice(0, 400)
          : 'CONTACT_READ_FAILED';
    return { ok: false, ready: false, reason };
  }
  const raw = res.data;
  const c = raw.contact ?? raw.data?.contact ?? raw;
  if (!c || typeof c !== 'object') {
    return { ok: false, ready: false, reason: 'CONTACT_PAYLOAD_MISSING' };
  }
  const v = c.is_myinvois_ready;
  const ready = v === true || v === 1 || String(v).toLowerCase() === 'true';
  return { ok: true, ready };
}

/** Same contact extraction as {@link parseBukkuContactMyInvoisReady}. */
function extractBukkuContactFromReadResponse(readRes) {
  if (!readRes || readRes.ok !== true || readRes.data == null) return null;
  const raw = readRes.data;
  const c = raw.contact ?? raw.data?.contact ?? raw;
  return c && typeof c === 'object' ? c : null;
}

/**
 * Coliving rental / operator invoice rule: only treat as “e-invoice create” when Bukku says MyInvois-ready **and**
 * core customer identity exists (name + NRIC/BRN/TIN). Otherwise POST plain sales invoice once — no second POST.
 */
function bukkuContactProfileCompleteForMyInvoisInvoiceCreate(c) {
  if (!c || typeof c !== 'object') return false;
  const flag = c.is_myinvois_ready;
  const bukkuReady = flag === true || flag === 1 || String(flag).toLowerCase() === 'true';
  if (!bukkuReady) return false;
  const nm = [c.legal_name, c.display_name, c.company_name].map((x) => String(x || '').trim()).find(Boolean);
  const idNo = [c.reg_no, c.tax_id_no].map((x) => (x != null ? String(x).trim() : '')).find((s) => s !== '');
  return !!(nm && idNo);
}

/**
 * Bukku POST /sales/invoices: set myinvois_action only when Company Setting e-invoice is on AND contact is MyInvois-ready.
 * If not ready or read fails → omit field → plain sales invoice (still creates invoice).
 * @returns {Promise<{ myinvois_action: string|undefined, meta: object }>}
 */
async function resolveBukkuCreateInvoiceMyInvoisAction(req, contactId) {
  const clientId = req?.client?.id;
  const cid = contactId != null && contactId !== '' ? Number(contactId) : NaN;
  if (!clientId || Number.isNaN(cid)) {
    return { myinvois_action: undefined, meta: { reason: 'missing_client_or_contact' } };
  }
  const enabled = await getClientEinvoiceEnabled(clientId, 'bukku');
  if (!enabled) {
    return { myinvois_action: undefined, meta: { reason: 'einvoice_disabled' } };
  }
  let readRes;
  try {
    readRes = await bukkuContact.read(req, cid);
  } catch (err) {
    return {
      myinvois_action: undefined,
      meta: { reason: 'contact_read_exception', detail: err?.message || String(err) }
    };
  }
  const parsed = parseBukkuContactMyInvoisReady(readRes);
  if (!parsed.ok) {
    return { myinvois_action: undefined, meta: { reason: 'contact_read_failed', detail: parsed.reason } };
  }
  if (!parsed.ready) {
    return { myinvois_action: undefined, meta: { reason: 'plain_invoice', myinvois_ready: false } };
  }
  const contact = extractBukkuContactFromReadResponse(readRes);
  if (!bukkuContactProfileCompleteForMyInvoisInvoiceCreate(contact)) {
    return {
      myinvois_action: undefined,
      meta: { reason: 'plain_invoice_contact_incomplete', myinvois_ready: false, myinvois_flag: contact?.is_myinvois_ready }
    };
  }
  return { myinvois_action: 'NORMAL', meta: { reason: 'einvoice', myinvois_ready: true } };
}

/**
 * Cleanlemons operator Bukku: `req.client.id` is `cln_operatordetail.id` (not Coliving `client_integration.client_id`).
 * Same rules as {@link resolveBukkuCreateInvoiceMyInvoisAction} — avoids Bukku/MyInvois edge paths that return HTTP 500
 * when company e-invoice is on but the create payload omits `myinvois_action`.
 */
async function getClnOperatorBukkuEinvoiceEnabled(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return false;
  try {
    const [rows] = await pool.query(
      `SELECT einvoice FROM cln_operator_integration
       WHERE operator_id = ? AND \`key\` = 'addonAccount' AND provider = 'bukku' AND enabled = 1
       LIMIT 1`,
      [oid]
    );
    const r = rows[0];
    if (!r) return false;
    const ev = r.einvoice;
    /** Only explicit “on” — avoid truthy strings / Buffer edge cases; no e-invoice ⇒ plain Bukku invoice only. */
    return ev === true || ev === 1 || Number(ev) === 1;
  } catch {
    return false;
  }
}

async function resolveBukkuCreateInvoiceMyInvoisActionForClnOperator(req, contactId) {
  const operatorId = req?.client?.id;
  const cid =
    contactId != null && contactId !== ''
      ? Number(typeof contactId === 'string' ? String(contactId).trim() : contactId)
      : NaN;
  if (!operatorId || Number.isNaN(cid)) {
    return { myinvois_action: undefined, meta: { reason: 'missing_operator_or_contact' } };
  }
  const enabled = await getClnOperatorBukkuEinvoiceEnabled(operatorId);
  if (!enabled) {
    return { myinvois_action: undefined, meta: { reason: 'einvoice_disabled' } };
  }
  let readRes;
  try {
    readRes = await bukkuContact.read(req, cid);
  } catch (err) {
    return {
      myinvois_action: undefined,
      meta: { reason: 'contact_read_exception', detail: err?.message || String(err) }
    };
  }
  const parsed = parseBukkuContactMyInvoisReady(readRes);
  if (!parsed.ok) {
    return { myinvois_action: undefined, meta: { reason: 'contact_read_failed', detail: parsed.reason } };
  }
  if (!parsed.ready) {
    return { myinvois_action: undefined, meta: { reason: 'plain_invoice', myinvois_ready: false } };
  }
  const contact = extractBukkuContactFromReadResponse(readRes);
  if (!bukkuContactProfileCompleteForMyInvoisInvoiceCreate(contact)) {
    return {
      myinvois_action: undefined,
      meta: { reason: 'plain_invoice_contact_incomplete', myinvois_ready: false, myinvois_flag: contact?.is_myinvois_ready }
    };
  }
  return { myinvois_action: 'NORMAL', meta: { reason: 'einvoice', myinvois_ready: true } };
}

/**
 * After a sales invoice is created: if e-invoice is enabled, optionally verify contact (Bukku: is_myinvois_ready), then submit to MyInvois.
 * Non-Bukku providers: submit when enabled (no contact readiness API in this codebase).
 * @param {object} req - must include client id + provider credentials (same as create invoice)
 * @param {{ provider: string, contactId?: string|number, invoiceIdOrDocNo: string }} opts
 * @returns {Promise<{ ok: boolean, submitted: boolean, skipped?: string, reason?: string, generalSuggested?: boolean }>}
 */
async function submitEInvoiceAfterInvoiceCreatedIfEnabled(req, opts) {
  const { provider, contactId, invoiceIdOrDocNo } = opts || {};
  if (!req?.client?.id || !provider || !invoiceIdOrDocNo) {
    return { ok: false, submitted: false, skipped: 'MISSING_PARAMS' };
  }

  const enabled = await getClientEinvoiceEnabled(req.client.id, provider);
  if (!enabled) {
    return { ok: true, submitted: false, skipped: 'einvoice_disabled' };
  }

  if (provider === 'bukku') {
    if (contactId == null || contactId === '') {
      return { ok: true, submitted: false, skipped: 'no_contact_id' };
    }
    let readRes;
    try {
      readRes = await bukkuContact.read(req, contactId);
    } catch (err) {
      return { ok: true, submitted: false, skipped: 'contact_read_exception', reason: err?.message || String(err) };
    }
    const parsed = parseBukkuContactMyInvoisReady(readRes);
    if (!parsed.ok) {
      return { ok: true, submitted: false, skipped: 'contact_read_failed', reason: parsed.reason };
    }
    if (!parsed.ready) {
      return { ok: true, submitted: false, skipped: 'contact_not_myinvois_ready' };
    }
  }

  const submitResult = await executeEInvoiceIfEnabled(req, { provider, invoiceIdOrDocNo });
  if (submitResult.submitted) {
    return { ok: true, submitted: true };
  }
  return {
    ok: submitResult.ok !== false,
    submitted: false,
    skipped: submitResult.reason || 'einvoice_submit_failed',
    reason: submitResult.reason,
    generalSuggested: submitResult.generalSuggested
  };
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
  const todayMy = getTodayMalaysiaDate();

  try {
    if (provider === 'bukku') {
      let currencyCode = currency;
      if (!currencyCode) {
        const cid = req?.client?.id;
        if (!cid) return { ok: false, reason: 'MISSING_CLIENT_ID' };
        const [crows] = await pool.query('SELECT currency FROM operatordetail WHERE id = ? LIMIT 1', [cid]);
        currencyCode = crows[0]?.currency;
      }
      const cc = String(currencyCode || '').trim().toUpperCase();
      if (!cc) return { ok: false, reason: 'CLIENT_CURRENCY_MISSING' };
      const bukkuCurrency = cc.slice(0, 3);
      const payload = {
        payment_mode: 'cash',
        contact_id: Number(contactId),
        date: todayMy,
        currency_code: bukkuCurrency,
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
      if (productId != null) {
        const pid = Number(productId);
        if (Number.isFinite(pid)) payload.form_items[0].product_id = pid;
      }
      const res = await bukkuInvoice.createinvoice(req, payload);
      const parsed = bukkuInvoice.parseBukkuSalesInvoiceCreateResponse(res);
      if (!parsed.invoiceId) return { ok: false, reason: res?.error || 'BUKKU_CREATE_FAILED' };
      return { ok: true, invoiceIdOrDocNo: parsed.invoiceId };
    }

    if (provider === 'xero') {
      const accountCode = await resolveXeroAccountCode(req, accountId);
      if (!accountCode) return { ok: false, reason: 'XERO_ACCOUNT_CODE_REQUIRED' };
      const Contact = typeof contactId === 'string' && contactId.length === 36 ? { ContactID: contactId } : { Name: 'General Customer' };
      let currencyCode = normalizeIso4217(currency);
      if (!currencyCode) currencyCode = await getXeroInvoiceCurrencyForClientId(req?.client?.id);
      const payload = {
        Type: 'ACCREC',
        Contact,
        CurrencyCode: currencyCode,
        Date: todayMy,
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
      if (!id) return { ok: false, reason: res?.error || 'XERO_CREATE_FAILED' };
      return { ok: true, invoiceIdOrDocNo: id };
    }

    if (provider === 'autocount') {
      const docDate = todayMy;
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
        date: todayMy
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

/** Default reason for e-invoice cancel when voiding rental invoice (MyInvois often requires reason). */
const EINVOICE_CANCEL_REASON_DEFAULT = 'change tenancy';

/**
 * Bukku GET /sales/invoices/:id — only cancel MyInvois when this invoice actually has a submitted e-invoice.
 * Plain sales invoices (no myinvois) should skip LHDN cancel and void in Bukku directly.
 */
function bukkuInvoiceHasSubmittedEinvoice(data) {
  if (!data || typeof data !== 'object') return false;
  const tx = data.transaction ?? data.data?.transaction ?? data;
  if (!tx || typeof tx !== 'object') return false;
  const uuid =
    tx.myinvois_uuid ??
    tx.lhdn_document_uuid ??
    tx.einvoice_uuid ??
    tx.myinvois_reference_uuid;
  if (uuid != null && String(uuid).trim() !== '') return true;
  const st = String(tx.myinvois_status ?? tx.einvoice_status ?? tx.myinvois_state ?? '').toLowerCase();
  if (st && /valid|submit|accept|complete|posted|success|issued/i.test(st)) return true;
  return false;
}

/**
 * Cancel e-invoice (MyInvois) for an invoice if client has e-invoice enabled.
 * Call before voiding the invoice in accounting so LHDN is updated.
 * Bukku: only calls cancel when GET invoice shows a submitted e-invoice; otherwise skip (void sales invoice only).
 * Most e-invoice cancel APIs require a reason; we pass opts.reason (default "change tenancy").
 * @param {object} req - req.client.id for client
 * @param {{ provider: string, invoiceIdOrDocNo: string, reason?: string }} opts
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, skipped?: string, reason?: string }>}
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
      const statusRes = await bukkuEinvoice.getEInvoiceStatus(req, invoiceIdOrDocNo);
      if (!statusRes || statusRes.ok !== true) {
        return { ok: true, cancelled: false, skipped: 'bukku_invoice_read_failed' };
      }
      if (!bukkuInvoiceHasSubmittedEinvoice(statusRes.data)) {
        return { ok: true, cancelled: false, skipped: 'no_einvoice_on_invoice' };
      }
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
  getClnOperatorBukkuEinvoiceEnabled,
  parseBukkuContactMyInvoisReady,
  resolveBukkuCreateInvoiceMyInvoisAction,
  resolveBukkuCreateInvoiceMyInvoisActionForClnOperator,
  submitEInvoiceAfterInvoiceCreatedIfEnabled,
  executeEInvoiceIfEnabled,
  createGeneralInvoice,
  ensureInvoiceCreatedThenEInvoice,
  buildAndSubmitGeneralEInvoice,
  cancelEInvoiceIfEnabled,
  EINVOICE_CANCEL_REASON_DEFAULT
};
