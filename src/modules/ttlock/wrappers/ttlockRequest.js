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
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const plain = (text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    console.warn('[ttlock] API returned non-JSON path=', path, 'status=', res.status, 'preview=', plain || text?.slice(0, 120));
    throw new Error(
      `TTLOCK_API_ERROR: HTTP ${res.status} from TTLock (non-JSON body). ${plain ? `Preview: ${plain}` : 'Retry later or check TTLock status.'}`
    );
  }
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
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const plain = (text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    console.warn('[ttlock] API returned non-JSON path=', path, 'status=', res.status, 'preview=', plain || text?.slice(0, 120));
    throw new Error(
      `TTLOCK_API_ERROR: HTTP ${res.status} from TTLock (non-JSON body). ${plain ? `Preview: ${plain}` : 'Retry later or check TTLock status.'}`
    );
  }
  return json;
}

module.exports = { buildQuery, ttlockGet, ttlockPost };
