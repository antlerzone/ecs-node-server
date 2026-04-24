const axios = require('axios');

const BASE_URL = 'https://api.bukku.my';

/** POST /sales/invoices — full request/response for debugging Bukku vs MyInvois validation (no Bearer token logged). */
function logBukkuSalesInvoice(method, endpoint, data, outcome) {
  try {
    const line = {
      tag: 'bukku-api/sales-invoices',
      ts: new Date().toISOString(),
      method: String(method || '').toUpperCase(),
      endpoint,
      note:
        'If company uses MyInvois, validation errors often appear in error body (not a separate e-invoice service call from this Node app).',
      ...(outcome.ok === true
        ? {
            outcome: 'http_ok',
            responseBody: outcome.data
          }
        : {
            outcome: 'http_error',
            httpStatus: outcome.status,
            errorBody: outcome.error
          })
    };
    if (data !== undefined) line.requestBody = data;
    console.log('[bukku-api]', JSON.stringify(line));
  } catch (e) {
    console.warn('[bukku-api] logBukkuSalesInvoice failed:', e?.message || e);
  }
}

/**
 * Call Bukku API. Requires token and subdomain (Company-Subdomain header).
 * @param {object} opts
 * @param {string} opts.method - get|post|put|patch|delete
 * @param {string} opts.endpoint - e.g. /sales/invoices
 * @param {string} opts.token - Bearer token
 * @param {string} opts.subdomain - Company subdomain (Company-Subdomain header)
 * @param {object} [opts.data] - JSON body for post/put/patch
 * @param {object} [opts.params] - Query params for get
 */
async function bukkurequest({ method = 'get', endpoint, token, subdomain, data, params }) {
  if (!token || !subdomain) {
    return { ok: false, error: 'missing bukku token or subdomain' };
  }
  const isSalesInvoicePost =
    String(method || '').toLowerCase() === 'post' && String(endpoint || '').includes('/sales/invoices');
  try {
    const res = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Company-Subdomain': subdomain,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      data,
      params
    });
    const out = {
      ok: true,
      data: res.data,
      status: res.status,
      /** Used by POST /sales/invoices when body omits id but API returns Location. */
      headers: res.headers && typeof res.headers === 'object' ? { ...res.headers } : undefined
    };
    if (isSalesInvoicePost) logBukkuSalesInvoice(method, endpoint, data, out);
    return out;
  } catch (err) {
    const out = {
      ok: false,
      status: err.response?.status,
      error: err.response?.data || err.message
    };
    if (isSalesInvoicePost) logBukkuSalesInvoice(method, endpoint, data, out);
    return out;
  }
}

/**
 * Upload file to Bukku (multipart/form-data). Use with FormData from 'form-data' package.
 * @param {object} opts
 * @param {string} opts.endpoint - e.g. /files
 * @param {string} opts.token - Bearer token
 * @param {string} opts.subdomain - Company subdomain
 * @param {object} opts.formData - FormData instance with 'file' field appended
 */
async function bukkuUpload({ endpoint, token, subdomain, formData }) {
  if (!token || !subdomain) {
    return { ok: false, error: 'missing bukku token or subdomain' };
  }
  try {
    const res = await axios({
      method: 'post',
      url: `${BASE_URL}${endpoint}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Company-Subdomain': subdomain,
        Accept: 'application/json',
        ...formData.getHeaders()
      },
      data: formData
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data || err.message
    };
  }
}

module.exports = bukkurequest;
module.exports.bukkuUpload = bukkuUpload;