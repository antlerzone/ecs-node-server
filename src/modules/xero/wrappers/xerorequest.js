const axios = require('axios');

const BASE_URL = 'https://api.xero.com/api.xro/2.0';

/**
 * Call Xero Accounting API. Requires OAuth2 access token and tenant id.
 * @param {object} opts
 * @param {string} opts.method - get|post|put|patch|delete
 * @param {string} opts.endpoint - e.g. /Accounts or /Invoices
 * @param {string} opts.accessToken - Bearer token
 * @param {string} opts.tenantId - Xero-tenant-id header
 * @param {object} [opts.data] - JSON body for post/put/patch
 * @param {object} [opts.params] - Query params for get
 */
async function xerorequest({ method = 'get', endpoint, accessToken, tenantId, data, params }) {
  if (!accessToken || !tenantId) {
    return { ok: false, error: 'missing xero access token or tenant id' };
  }
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  try {
    const res = await axios({
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-tenant-id': tenantId,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      data,
      params
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

module.exports = xerorequest;
