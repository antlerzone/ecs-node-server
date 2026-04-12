/**
 * Finverse API HTTP layer.
 * Per official docs: all API calls (test and live) use production: https://api.prod.finverse.net/
 * Test vs live is by app type in Developer Portal (Test app vs Live team credentials), not by URL.
 * Ref: https://docs.finverse.com
 */

const BASE_URL = process.env.FINVERSE_BASE_URL || 'https://api.prod.finverse.net';

/** Per docs: POST /auth/customer/token (Generate customer_token). Override with FINVERSE_AUTH_TOKEN_PATH if needed. */
const AUTH_TOKEN_PATH = process.env.FINVERSE_AUTH_TOKEN_PATH || '/auth/customer/token';

const FINVERSE_FETCH_TIMEOUT_MS = Number(process.env.FINVERSE_FETCH_TIMEOUT_MS) || 25000;

/**
 * POST /auth/customer/token – generate customer_token (client_credentials).
 * Ref: https://docs.finverse.com – Auth (Customer App) "Generate customer_token". Authentication: client_id and client_secret in JSON body.
 * @param {{ client_id: string, client_secret: string }} creds
 * @returns {Promise<{ access_token: string, expires_in?: number }>}
 */
async function getCustomerAccessToken(creds) {
  const url = `${BASE_URL}${AUTH_TOKEN_PATH}`;
  const body = {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    grant_type: 'client_credentials'
  };
  // _source: 'env' = from .env; 'client_integration' = from DB (may be old – remove row or update to use .env)
  console.log('[FINVERSE] auth/customer/token request', {
    url,
    client_id: creds.client_id,
    client_id_length: creds.client_id?.length,
    secret_length: creds.client_secret?.length,
    source: creds._source || 'unknown'
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINVERSE_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    console.error('[FINVERSE] auth/customer/token fetch failed', err?.message || err, 'url=', url);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await res.text();
  console.log('[FINVERSE] auth/customer/token response', { status: res.status, statusText: res.statusText, bodyLength: text?.length, contentType: res.headers.get('content-type') });
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.error('[FINVERSE] auth/customer/token non-JSON', 'text=', text?.slice(0, 500));
    throw new Error(`FINVERSE_AUTH_FAILED: ${text?.slice(0, 100)}`);
  }
  if (!res.ok) {
    const raw = json.error_description ?? json.error ?? text?.slice(0, 200);
    const errMsg = typeof raw === 'string' ? raw : (raw?.message ?? raw?.error_description ?? JSON.stringify(raw));
    const requestId = json.error?.request_id ?? json.request_id;
    console.error('[FINVERSE] auth/customer/token error', { status: res.status, errMsg, request_id: requestId, fullBody: json });
    throw new Error(`FINVERSE_AUTH_FAILED: ${errMsg}`);
  }
  if (!json.access_token) {
    console.error('[FINVERSE] auth/customer/token no access_token in body', { fullBody: json });
    throw new Error('FINVERSE_AUTH_NO_ACCESS_TOKEN');
  }
  console.log('[FINVERSE] auth/customer/token success', { expires_in: json.expires_in });
  return { access_token: json.access_token, expires_in: json.expires_in };
}

/**
 * Generic request with Bearer token.
 * @param {string} method - GET | POST | etc.
 * @param {string} path - e.g. /customer/link_tokens
 * @param {{ accessToken: string, body?: object, params?: Record<string, string> }} opts
 */
async function finverseRequest(method, path, { accessToken, body, params = {} }) {
  const q = new URLSearchParams(params).toString();
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}${q ? `?${q}` : ''}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINVERSE_FETCH_TIMEOUT_MS);
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    signal: controller.signal
  };
  if (body != null && method !== 'GET') options.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url, options);
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (res.ok) return {};
    throw new Error(`FINVERSE_API_ERROR: ${res.status} ${text?.slice(0, 150)}`);
  }
  if (!res.ok) {
    const raw = json.error_description ?? json.error ?? json.message ?? text?.slice(0, 200);
    const errMsg = typeof raw === 'string' ? raw : (raw?.message ?? raw?.error_description ?? JSON.stringify(raw));
    console.error('[FINVERSE]', method, path, res.status, errMsg);
    console.error('[FINVERSE] response full body:', JSON.stringify(json, null, 2));
    if (text && text.length < 2000) console.error('[FINVERSE] response raw text:', text);
    throw new Error(`FINVERSE_API_ERROR: ${errMsg}`);
  }
  return json;
}

module.exports = {
  BASE_URL,
  getCustomerAccessToken,
  finverseRequest
};
