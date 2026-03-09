const axios = require('axios');

const BASE_URL = 'https://accounting-api.autocountcloud.com';

/**
 * Call AutoCount Cloud Accounting API.
 * Auth: API-Key + Key-ID headers (from Settings > API Keys in Cloud Accounting).
 * @param {object} opts
 * @param {string} opts.method - get|post|put|patch|delete
 * @param {string|number} opts.accountBookId - account book id (path segment)
 * @param {string} opts.endpoint - e.g. /invoice or /invoice/void (no leading slash)
 * @param {string} opts.apiKey - API Key string from API Key record
 * @param {string} opts.keyId - Key ID from API Key record
 * @param {object} [opts.data] - JSON body for post/put/patch
 * @param {object} [opts.params] - Query params for get/post
 */
async function autocountrequest({
  method = 'get',
  accountBookId,
  endpoint,
  apiKey,
  keyId,
  data,
  params
}) {
  if (!apiKey || !keyId) {
    return { ok: false, error: 'missing autocount apiKey or keyId' };
  }
  if (accountBookId == null || accountBookId === '') {
    return { ok: false, error: 'missing autocount accountBookId' };
  }
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${BASE_URL}/${accountBookId}${path}`;
  try {
    const res = await axios({
      method,
      url,
      headers: {
        'API-Key': apiKey,
        'Key-ID': keyId,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      data,
      params
    });
    return { ok: true, data: res.data, status: res.status, headers: res.headers };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data || err.message
    };
  }
}

module.exports = autocountrequest;
