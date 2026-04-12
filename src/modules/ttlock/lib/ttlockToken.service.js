/**
 * TTLock OAuth2 token (per client, SaaS).
 * Coliving: `ttlocktoken.client_id` → operatordetail.id (FK).
 * Cleanlemons: cln_clientdetail / cln_operatordetail IDs must use `cln_ttlocktoken` (migration 0222).
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
function parseTtlockValuesJson(raw) {
  let values;
  try {
    values = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  } catch {
    values = {};
  }
  const username = values?.ttlock_username;
  const password = values?.ttlock_password;
  if (!username || !password) return null;
  return { username, password };
}

/**
 * Coliving: client_integration (client_id = operatordetail.id).
 * Cleanlemons B2B: cln_client_integration (clientdetail_id = cln_clientdetail.id).
 * Legacy Cleanlemons operator row: cln_operator_integration (operator_id = cln_operatordetail.id).
 */
async function getTTLockAccountByClient(clientId) {
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1
     LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const creds = parseTtlockValuesJson(rows[0].values_json);
    if (creds) return creds;
  }
  try {
    const [clnClientRows] = await pool.query(
      `SELECT values_json FROM cln_client_integration
       WHERE clientdetail_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1
       LIMIT 1`,
      [String(clientId)]
    );
    if (clnClientRows.length) {
      const creds = parseTtlockValuesJson(clnClientRows[0].values_json);
      if (creds) return creds;
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
  }
  try {
    const [clnRows] = await pool.query(
      `SELECT values_json FROM cln_operator_integration
       WHERE operator_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1
       LIMIT 1`,
      [String(clientId)]
    );
    if (clnRows.length) {
      const creds = parseTtlockValuesJson(clnRows[0].values_json);
      if (creds) return creds;
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
  }
  throw new Error('TTLOCK_NOT_CONFIGURED');
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

function isMissingTableError(e) {
  const msg = String(e?.sqlMessage || e?.message || '');
  return /doesn't exist/i.test(msg) || /Unknown table/i.test(msg);
}

/**
 * Where to persist TTLock tokens: Coliving operatordetail uses `ttlocktoken`; Cleanlemons uses `cln_ttlocktoken`.
 */
async function detectTtlockTokenScope(clientId) {
  const cid = String(clientId || '').trim();
  if (!cid) return null;
  const [[op]] = await pool.query('SELECT id FROM operatordetail WHERE id = ? LIMIT 1', [cid]);
  if (op?.id) return 'operatordetail';
  try {
    const [[cd]] = await pool.query('SELECT id FROM cln_clientdetail WHERE id = ? LIMIT 1', [cid]);
    if (cd?.id) return 'cln_clientdetail';
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
  try {
    const [[clnOp]] = await pool.query('SELECT id FROM cln_operatordetail WHERE id = ? LIMIT 1', [cid]);
    if (clnOp?.id) return 'cln_operatordetail';
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
  }
  return null;
}

async function saveTokenOperatordetail(clientId, data) {
  const id = crypto.randomUUID();
  const accessToken = data.access_token;
  const refreshTokenVal = data.refresh_token ?? null;
  const expiresIn = data.expires_in ?? 0;

  const [existing] = await pool.query(
    'SELECT id FROM ttlocktoken WHERE client_id = ? LIMIT 1',
    [clientId]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE ttlocktoken SET accesstoken = ?, refreshtoken = ?, expiresin = ?, updated_at = NOW() WHERE client_id = ?`,
      [accessToken, refreshTokenVal, expiresIn, clientId]
    );
    return;
  }

  await pool.query(
    `INSERT INTO ttlocktoken (id, client_id, accesstoken, refreshtoken, expiresin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [id, clientId, accessToken, refreshTokenVal, expiresIn]
  );
}

async function saveTokenClnScoped(clientId, scope, data) {
  const accessToken = data.access_token;
  const refreshTokenVal = data.refresh_token ?? null;
  const expiresIn = data.expires_in ?? 0;
  const clientdetailId = scope === 'cln_clientdetail' ? clientId : null;
  const operatorId = scope === 'cln_operatordetail' ? clientId : null;

  let existing;
  try {
    if (clientdetailId) {
      const [rows] = await pool.query(
        'SELECT id FROM cln_ttlocktoken WHERE clientdetail_id = ? LIMIT 1',
        [clientId]
      );
      existing = rows;
    } else {
      const [rows] = await pool.query(
        'SELECT id FROM cln_ttlocktoken WHERE operator_id = ? LIMIT 1',
        [clientId]
      );
      existing = rows;
    }
  } catch (e) {
    if (isMissingTableError(e)) {
      const err = new Error('CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222');
      err.code = 'CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222';
      throw err;
    }
    throw e;
  }

  if (existing.length > 0) {
    await pool.query(
      `UPDATE cln_ttlocktoken SET accesstoken = ?, refreshtoken = ?, expiresin = ?, updated_at = NOW(3) WHERE id = ?`,
      [accessToken, refreshTokenVal, expiresIn, existing[0].id]
    );
    return;
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO cln_ttlocktoken (id, clientdetail_id, operator_id, accesstoken, refreshtoken, expiresin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [id, clientdetailId, operatorId, accessToken, refreshTokenVal, expiresIn]
  );
}

/**
 * Save or update token. Routes to `ttlocktoken` (Coliving operatordetail) or `cln_ttlocktoken` (Cleanlemons).
 */
async function saveToken(clientId, data) {
  const cid = String(clientId || '').trim();
  const scope = await detectTtlockTokenScope(cid);
  if (scope === 'operatordetail') {
    await saveTokenOperatordetail(cid, data);
    return;
  }
  if (scope === 'cln_clientdetail' || scope === 'cln_operatordetail') {
    await saveTokenClnScoped(cid, scope, data);
    return;
  }
  const err = new Error('TTLOCK_TOKEN_CLIENT_UNKNOWN_SCOPE');
  err.code = 'TTLOCK_TOKEN_CLIENT_UNKNOWN_SCOPE';
  throw err;
}

function normalizeToken(raw) {
  return {
    accessToken: raw.accesstoken ?? raw.access_token,
    refreshToken: raw.refreshtoken ?? raw.refresh_token,
    expiresIn: raw.expiresin ?? raw.expires_in,
    uid: raw.uid
  };
}

async function readStoredTtlockTokenRow(clientId) {
  const cid = String(clientId || '').trim();
  const scope = await detectTtlockTokenScope(cid);
  if (scope === 'operatordetail') {
    const [rows] = await pool.query(
      'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM ttlocktoken WHERE client_id = ? LIMIT 1',
      [cid]
    );
    return { scope, row: rows[0] || null };
  }
  if (scope === 'cln_clientdetail') {
    try {
      const [rows] = await pool.query(
        'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM cln_ttlocktoken WHERE clientdetail_id = ? LIMIT 1',
        [cid]
      );
      return { scope, row: rows[0] || null };
    } catch (e) {
      if (isMissingTableError(e)) {
        const err = new Error('CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222');
        err.code = 'CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222';
        throw err;
      }
      throw e;
    }
  }
  if (scope === 'cln_operatordetail') {
    try {
      const [rows] = await pool.query(
        'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM cln_ttlocktoken WHERE operator_id = ? LIMIT 1',
        [cid]
      );
      return { scope, row: rows[0] || null };
    } catch (e) {
      if (isMissingTableError(e)) {
        const err = new Error('CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222');
        err.code = 'CLN_TTLOCKTOKEN_TABLE_MISSING_RUN_MIGRATION_0222';
        throw err;
      }
      throw e;
    }
  }
  return { scope: null, row: null };
}

/**
 * Get valid TTLock access token (use existing, refresh, or login).
 * @param {string} clientId - operatordetail.id (Coliving) or cln_clientdetail.id / cln_operatordetail.id (Cleanlemons)
 */
async function getValidTTLockToken(clientId) {
  const { scope, row } = await readStoredTtlockTokenRow(clientId);

  if (row) {
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
