/**
 * TTLock Open API HTTP helper.
 * Base: https://euapi.ttlock.com/v3
 * All requests need clientId + accessToken (from ttlockCreds).
 */

const BASE = 'https://euapi.ttlock.com/v3';

/**
 * Build application/x-www-form-urlencoded query string.
 * Skips undefined/null.
 */
function buildQuery(params = {}) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * GET request; params merged with auth (clientId, accessToken, date).
 */
async function ttlockGet(path, auth, params = {}) {
  const q = buildQuery({
    clientId: auth.clientId,
    accessToken: auth.accessToken,
    date: Date.now(),
    ...params
  });
  const url = `${BASE}${path}?${q}`;
  const res = await fetch(url);
  return res.json();
}

/**
 * POST form-urlencoded body; body merged with auth.
 */
async function ttlockPost(path, auth, body = {}) {
  const data = buildQuery({
    clientId: auth.clientId,
    accessToken: auth.accessToken,
    date: Date.now(),
    ...body
  });
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: data
  });
  return res.json();
}

module.exports = { buildQuery, ttlockGet, ttlockPost };
