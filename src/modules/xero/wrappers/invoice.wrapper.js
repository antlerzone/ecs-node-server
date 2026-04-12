const xerorequest = require('./xerorequest');
const { getXeroCreds } = require('../lib/xeroCreds');

/**
 * Create invoice(s). Xero API expects body { Invoices: [ ... ] }.
 */
async function create(req, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = Array.isArray(payload) ? { Invoices: payload } : { Invoices: [payload] };
  return xerorequest({
    method: 'post',
    endpoint: '/Invoices',
    accessToken,
    tenantId,
    data: body
  });
}

/**
 * List invoices. Query: where, order, ids, invoiceNumbers, contactIDs, statuses, ifModifiedSince.
 */
async function list(req, query = {}) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: '/Invoices',
    accessToken,
    tenantId,
    params: query
  });
}

/**
 * Get single invoice by ID.
 */
async function read(req, invoiceId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  return xerorequest({
    method: 'get',
    endpoint: `/Invoices/${encodeURIComponent(invoiceId)}`,
    accessToken,
    tenantId
  });
}

/**
 * Update invoice. Xero expects POST /Invoices with body { Invoices: [ { InvoiceID, ... } ] }.
 */
async function update(req, invoiceId, payload) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const body = { Invoices: [{ InvoiceID: invoiceId, ...payload }] };
  return xerorequest({
    method: 'post',
    endpoint: '/Invoices',
    accessToken,
    tenantId,
    data: body
  });
}

/**
 * Get online invoice URL for payment link. GET /Invoices/{id}/OnlineInvoice.
 * Only available for AUTHORISED (published) sales invoices.
 * @returns {Promise<{ ok: boolean, url?: string, error?: string }>}
 */
async function getOnlineInvoiceUrl(req, invoiceId) {
  const { accessToken, tenantId } = await getXeroCreds(req);
  const res = await xerorequest({
    method: 'get',
    endpoint: `/Invoices/${encodeURIComponent(invoiceId)}/OnlineInvoice`,
    accessToken,
    tenantId
  });
  if (!res.ok) return { ok: false, error: res.error?.Message || res.error || 'XERO_ONLINE_INVOICE_FAILED' };
  const oi = res.data?.OnlineInvoices;
  const url =
    // Common shape: { OnlineInvoices: [ { OnlineInvoiceUrl } ] }
    (Array.isArray(oi) ? oi[0]?.OnlineInvoiceUrl : null) ??
    // Alternative shape: { OnlineInvoices: { OnlineInvoice: { OnlineInvoiceUrl } } }
    oi?.OnlineInvoice?.OnlineInvoiceUrl ??
    // Alternative shape: { OnlineInvoice: { OnlineInvoiceUrl } }
    res.data?.OnlineInvoice?.OnlineInvoiceUrl ??
    // Direct fallback
    res.data?.OnlineInvoiceUrl;
  return url ? { ok: true, url: String(url) } : { ok: false, error: 'NO_ONLINE_INVOICE_URL' };
}

module.exports = {
  create,
  list,
  read,
  update,
  getOnlineInvoiceUrl
};
