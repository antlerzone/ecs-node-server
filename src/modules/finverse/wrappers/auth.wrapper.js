/**
 * Finverse auth & link flow (per operator).
 * 1) Customer access token (client_credentials)
 * 2) Generate link token → link_url for Finverse Link UI
 * 3) Exchange authorization code → login identity access token (for Data API)
 */

const { getValidCustomerAccessToken } = require('../lib/finverseToken.service');
const { getFinverseCredsByClient } = require('../lib/finverseCreds');
const { finverseRequest, BASE_URL } = require('./finverseRequest');

/**
 * Generate link token; returns link_url for launching Finverse Link UI.
 * @param {string} clientId - Our operator/client id
 * @param {{ user_id: string, redirect_uri: string, state: string, response_mode?: string, response_type?: string }} opts
 * @returns {Promise<{ link_url: string }>}
 */
async function generateLinkToken(clientId, opts = {}) {
  const { access_token } = await getValidCustomerAccessToken(clientId);
  const creds = await getFinverseCredsByClient(clientId);
  const body = {
    client_id: creds.client_id,
    user_id: opts.user_id || clientId,
    redirect_uri: opts.redirect_uri || creds.redirect_uri,
    state: opts.state || '',
    response_mode: opts.response_mode || 'form_post',
    response_type: opts.response_type || 'code',
    grant_type: 'client_credentials'
  };
  if (!body.redirect_uri) throw new Error('FINVERSE_REDIRECT_URI_REQUIRED');
  // Data API: POST /link/token (not /customer/link_tokens). Ref: docs.finverse.com Get Started > Data API.
  const data = await finverseRequest('POST', '/link/token', { accessToken: access_token, body });
  if (!data.link_url) throw new Error('FINVERSE_NO_LINK_URL');
  return { link_url: data.link_url };
}

/**
 * Exchange authorization code (from Finverse Link callback) for login identity access token.
 * Use this token to call getLoginIdentity, listAccounts, listTransactions.
 * @param {string} clientId - Our operator id
 * @param {{ code: string, redirect_uri?: string }} opts
 * @returns {Promise<{ access_token: string, login_identity_id?: string }>}
 */
async function exchangeCodeForLoginIdentity(clientId, opts) {
  const { access_token: customerToken } = await getValidCustomerAccessToken(clientId);
  const creds = await getFinverseCredsByClient(clientId);
  const redirect_uri = opts.redirect_uri || creds.redirect_uri;
  if (!redirect_uri) throw new Error('FINVERSE_REDIRECT_URI_REQUIRED');
  if (!opts.code) throw new Error('FINVERSE_CODE_REQUIRED');

  // Code exchange: POST /auth/token. API returns 401 "Bearer token required" without customer token;
  // same Bearer as /link/token (customer access token from /auth/customer/token).
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    client_id: creds.client_id,
    redirect_uri
  });
  const url = `${BASE_URL}/auth/token`;
  console.log('[FINVERSE] POST /auth/token code exchange', { clientId, redirect_uri, code_length: (opts.code || '').length, auth: 'Bearer customer_token' });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${customerToken}`
    },
    body: form.toString()
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new Error(`FINVERSE_API_ERROR: ${res.status} ${text?.slice(0, 150)}`);
    throw new Error('FINVERSE_EXCHANGE_BAD_RESPONSE');
  }
  if (!res.ok) {
    const errMsg = data.error?.message ?? data.error_description ?? data.message ?? text?.slice(0, 200);
    console.error('[FINVERSE] POST /auth/token', res.status, errMsg, data);
    throw new Error(`FINVERSE_API_ERROR: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`);
  }
  if (!data.access_token) throw new Error('FINVERSE_EXCHANGE_NO_ACCESS_TOKEN');
  return {
    access_token: data.access_token,
    login_identity_id: data.login_identity_id
  };
}

module.exports = {
  generateLinkToken,
  exchangeCodeForLoginIdentity
};
