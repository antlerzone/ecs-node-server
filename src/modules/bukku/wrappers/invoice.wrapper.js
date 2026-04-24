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

function pickNonEmptyId(...candidates) {
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const s = String(c).trim();
    if (s !== '') return c;
  }
  return null;
}

/**
 * Same priority idea as `resolveBukkuSalesTargetTransactionId` in rentalcollection-invoice.service.js:
 * prefer numeric `bukku_invoice_id`, then numeric `invoiceid` (ignore IV-xxxx doc numbers for API id).
 */
function pickFirstNumericBukkuSalesTransactionId(body, tx) {
  const b = body && typeof body === 'object' ? body : {};
  const t = tx && typeof tx === 'object' ? tx : {};
  const fields = [
    b.bukku_invoice_id,
    t.bukku_invoice_id,
    b.bukkuInvoiceId,
    t.bukkuInvoiceId,
    b.invoiceid,
    t.invoiceid,
    b.invoiceId,
    t.invoiceId
  ];
  for (const c of fields) {
    const s = c == null ? '' : String(c).trim();
    if (/^\d+$/.test(s)) return s;
  }
  return null;
}

/** Some Bukku responses use `transaction_id` or nest under `data` only. */
function parseTransactionIdFromLocationHeader(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const loc = headers.location || headers.Location;
  if (!loc || typeof loc !== 'string') return null;
  const m = loc.match(/\/sales\/invoices\/(\d+)/i) || loc.match(/\/invoices\/(\d+)/i);
  return m ? m[1] : null;
}

/**
 * POST /sales/invoices success body (varies by API version).
 * Coliving UI link fallbacks: `coliving/next-app/app/operator/invoice/page.tsx` → `resolveBukkuInvoiceHref`
 * (invoiceurl, then numeric id + subdomain). Create path uses this parser via rentalcollection-invoice + Cleanlemons operator accounting.
 * `bukkurequest` returns `{ ok: true, data: <API body>, status?, headers? }`.
 */
function parseBukkuSalesInvoiceCreateResponse(res) {
  const empty = { invoiceId: null, shortLink: null, documentNumber: null };
  if (!res || res.ok === false) {
    return empty;
  }
  const root = res.data;
  if (!root || typeof root !== 'object') {
    const fromLoc = parseTransactionIdFromLocationHeader(res.headers);
    if (fromLoc != null && fromLoc !== '') {
      return { invoiceId: String(fromLoc), shortLink: null, documentNumber: null };
    }
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
        : body.sale_invoice != null && typeof body.sale_invoice === 'object'
          ? body.sale_invoice
          : body.sales_invoice != null && typeof body.sales_invoice === 'object'
            ? body.sales_invoice
            : body.saleInvoice != null && typeof body.saleInvoice === 'object'
              ? body.saleInvoice
              : body;
  let id = pickNonEmptyId(
    tx.id,
    tx.invoice_id,
    tx.transaction_id,
    body.transaction_id,
    body.id,
    body.invoice_id,
    tx.transaction?.id,
    tx.transaction?.invoice_id,
    body.transaction?.id,
    body.transaction?.invoice_id,
    body.transaction?.transaction_id,
    body.bukku_invoice_id,
    tx.bukku_invoice_id,
    body.bukkuInvoiceId,
    tx.bukkuInvoiceId,
    body.invoiceid,
    tx.invoiceid,
    body.invoiceId,
    tx.invoiceId
  );
  const numericEcho = pickFirstNumericBukkuSalesTransactionId(body, tx);
  if (!id || !/^\d+$/.test(String(id).trim())) {
    if (numericEcho) id = numericEcho;
  }
  const shortLink =
    pickNonEmptyId(tx.short_link, body.short_link, tx.shortLink, body.shortLink) || null;
  const documentNumber =
    pickNonEmptyId(tx.number, body.number, tx.document_number, body.document_number) || null;
  if (id == null || id === '') {
    const fromLoc = parseTransactionIdFromLocationHeader(res.headers);
    if (fromLoc != null && fromLoc !== '') {
      const sl =
        shortLink != null && String(shortLink).trim() !== ''
          ? String(shortLink).trim()
          : null;
      const doc = documentNumber != null && String(documentNumber).trim() !== '' ? String(documentNumber).trim() : null;
      return { invoiceId: String(fromLoc), shortLink: sl, documentNumber: doc };
    }
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

/**
 * @param {object} body
 * @param {{ omitFormItemProductIds?: boolean }} [options] — When true, strips `product_id` / `product_unit_id` from form_items before POST.
 */
function normalizeCreateInvoiceBodyForBukkuApi(body, options = {}) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  const omitPid = !!options.omitFormItemProductIds;
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
      if (omitPid) {
        delete row.product_id;
        delete row.product_unit_id;
      }
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
async function createinvoice(req, payload, options = {}) {
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
  const data = normalizeCreateInvoiceBodyForBukkuApi(value, options);
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