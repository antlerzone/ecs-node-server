const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');
const { create_invoice_schema } = require('../validators/invoice.validator');
const { utcDatetimeFromDbToMalaysiaDateOnly } = require('../../../utils/dateMalaysia');

/**
 * Joi `joi.date().iso()` turns `date` into a JavaScript Date; JSON.stringify sends
 * `2026-03-22T00:00:00.000Z` but Bukku validates `date_format:Y-m-d` on the string.
 */
function toYmdForBukkuApi(v) {
  if (v == null) return v;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return v;
    return utcDatetimeFromDbToMalaysiaDateOnly(v);
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return v;
}

/**
 * POST /sales/invoices success body (varies by API version):
 * - `{ transaction: { id, number, short_link, ... } }`
 * - `{ data: { id, ... } }` or nested `data.transaction`
 * `bukkurequest` returns `{ ok: true, data: <API body> }`.
 */
function parseBukkuSalesInvoiceCreateResponse(res) {
  const empty = { invoiceId: null, shortLink: null, documentNumber: null };
  if (!res || res.ok === false) {
    return empty;
  }
  const root = res.data;
  if (!root || typeof root !== 'object') {
    return empty;
  }
  /** Merge `data` wrapper so `id` at `body.data.id` is visible at top level. */
  const body =
    root.data != null && typeof root.data === 'object' && !Array.isArray(root.data)
      ? { ...root, ...root.data }
      : root;
  const tx =
    body.transaction != null && typeof body.transaction === 'object'
      ? body.transaction
      : body.invoice != null && typeof body.invoice === 'object'
        ? body.invoice
        : body;
  const id =
    tx.id != null && tx.id !== ''
      ? tx.id
      : tx.invoice_id != null && tx.invoice_id !== ''
        ? tx.invoice_id
        : body.id != null && body.id !== ''
          ? body.id
          : null;
  const shortLink = tx.short_link != null ? tx.short_link : body.short_link;
  const documentNumber = tx.number != null ? tx.number : body.number;
  if (id == null || id === '') {
    try {
      console.warn(
        '[bukku] parseBukkuSalesInvoiceCreateResponse: no id in response; keys:',
        Object.keys(body || {}),
        'sample:',
        JSON.stringify(root).slice(0, 400)
      );
    } catch (_) {}
    return empty;
  }
  const sl = shortLink != null && String(shortLink).trim() ? String(shortLink).trim() : null;
  const doc = documentNumber != null && String(documentNumber).trim() ? String(documentNumber).trim() : null;
  return { invoiceId: String(id), shortLink: sl, documentNumber: doc };
}

function normalizeCreateInvoiceBodyForBukkuApi(body) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  if (out.date != null) out.date = toYmdForBukkuApi(out.date);
  if (Array.isArray(out.term_items)) {
    out.term_items = out.term_items.map((t) => {
      if (!t || typeof t !== 'object') return t;
      const row = { ...t };
      if (row.date != null) row.date = toYmdForBukkuApi(row.date);
      return row;
    });
  }
  if (Array.isArray(out.form_items)) {
    out.form_items = out.form_items.map((f) => {
      if (!f || typeof f !== 'object') return f;
      const row = { ...f };
      if (row.service_date != null) row.service_date = toYmdForBukkuApi(row.service_date);
      return row;
    });
  }
  return out;
}

/**
 * POST /sales/invoices — same Joi as `bukku/routes/invoice.routes.js` so internal callers
 * (rentalcollection-invoice, einvoice) cannot send payloads that fail Bukku term_items rules.
 */
async function createinvoice(req, payload) {
  const { error, value } = create_invoice_schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    const message = error.details.map((d) => d.message).join('; ');
    return {
      ok: false,
      error: {
        message: 'BUKKU_INVOICE_PAYLOAD_INVALID',
        errors: error.details,
        validation: message
      }
    };
  }
  const data = normalizeCreateInvoiceBodyForBukkuApi(value);
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'post',
    endpoint: '/sales/invoices',
    token,
    subdomain,
    data
  });
}

/**
 * list invoices
 */
async function listinvoices(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'get',
    endpoint: '/sales/invoices',
    token,
    subdomain,
    params: query
  });
}

/**
 * read single invoice
 */
async function readinvoice(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'get',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain
  });
}

/**
 * update invoice
 */
async function updateinvoice(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'put',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain,
    data: payload
  });
}

/**
 * update invoice status
 */
async function updateinvoicestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'patch',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain,
    data: payload
  });
}

/**
 * delete invoice
 */
async function deleteinvoice(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({
    method: 'delete',
    endpoint: `/sales/invoices/${transactionId}`,
    token,
    subdomain
  });
}

module.exports = {
  createinvoice,
  listinvoices,
  readinvoice,
  updateinvoice,
  updateinvoicestatus,
  deleteinvoice,
  parseBukkuSalesInvoiceCreateResponse
};