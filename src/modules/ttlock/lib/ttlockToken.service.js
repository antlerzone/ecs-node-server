/**
 * TTLock OAuth2 token (per client, SaaS).
 * Uses ttlocktoken table and client_integration (key=smartDoor, provider=ttlock) for credentials.
 * Env: TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET (TTLock Open Platform app).
 */

const crypto = require('crypto');
const pool = require('../../../config/db');

const TTLOCK_TOKEN_URL = 'https://euapi.ttlock.com/oauth2/token';
const BUFFER_MS = 60 * 1000; // refresh 1 min before expiry

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

/**
 * Get TTLock account (username/password) for client from client_integration.
 * Expects integration: key=smartDoor, provider=ttlock, values_json: { ttlock_username, ttlock_password }.
 */
async function getTTLockAccountByClient(clientId) {
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('TTLOCK_NOT_CONFIGURED');
  const values = typeof rows[0].values_json === 'string'
    ? JSON.parse(rows[0].values_json)
    : rows[0].values_json;
  const username = values?.ttlock_username;
  const password = values?.ttlock_password;
  if (!username || !password) throw new Error('TTLOCK_NOT_CONFIGURED');
  return { username, password };
}

/**
 * Request new token (username + MD5 password).
 */
async function requestNewToken({ username, password }) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('TTLOCK_APP_CREDENTIALS_MISSING');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password: md5(password)
  }).toString();

  const res = await fetch(TTLOCK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.errmsg || 'TTLOCK_AUTH_FAILED');
  return data;
}

/**
 * Refresh token.
 */
async function refreshToken(refreshToken) {
  const clientId = process.env.TTLOCK_CLIENT_ID;
  const clientSecret = process.env.TTLOCK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('TTLOCK_APP_CREDENTIALS_MISSING');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();

  const res = await fetch(TTLOCK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  return res.json();
}

/**
 * Save or update token for client in ttlocktoken.
 * DB columns: accesstoken, refreshtoken, expiresin, updated_at
 */
async function saveToken(clientId, data) {
  const id = crypto.randomUUID();
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token ?? null;
  const expiresIn = data.expires_in ?? 0;

  const [existing] = await pool.query(
    'SELECT id FROM ttlocktoken WHERE client_id = ? LIMIT 1',
    [clientId]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE ttlocktoken SET accesstoken = ?, refreshtoken = ?, expiresin = ?, updated_at = NOW() WHERE client_id = ?`,
      [accessToken, refreshToken, expiresIn, clientId]
    );
    return;
  }

  await pool.query(
    `INSERT INTO ttlocktoken (id, client_id, accesstoken, refreshtoken, expiresin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, clientId, accessToken, refreshToken, expiresIn]
  );
}

function normalizeToken(raw) {
  return {
    accessToken: raw.accesstoken ?? raw.access_token,
    refreshToken: raw.refreshtoken ?? raw.refresh_token,
    expiresIn: raw.expiresin ?? raw.expires_in,
    uid: raw.uid
  };
}

/**
 * Get valid TTLock access token for client (use existing, refresh, or login).
 * @param {string} clientId - clientdetail.id
 * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number, uid?: string }>}
 */
async function getValidTTLockToken(clientId) {
  const [rows] = await pool.query(
    'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM ttlocktoken WHERE client_id = ? LIMIT 1',
    [clientId]
  );

  if (rows.length > 0) {
    const row = rows[0];
    const updatedAt = new Date(row.updated_at).getTime();
    const expiresMs = (row.expiresin || 0) * 1000;
    if (Date.now() < updatedAt + expiresMs - BUFFER_MS) {
      return normalizeToken(row);
    }
    if (row.refreshtoken) {
      const refreshed = await refreshToken(row.refreshtoken);
      if (refreshed.access_token) {
        await saveToken(clientId, refreshed);
        return normalizeToken(refreshed);
      }
    }
  }

  const account = await getTTLockAccountByClient(clientId);
  const fresh = await requestNewToken(account);
  await saveToken(clientId, fresh);
  return normalizeToken(fresh);
}

module.exports = {
  getValidTTLockToken,
  getTTLockAccountByClient,
  requestNewToken,
  refreshToken,
  saveToken
};
