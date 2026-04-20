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
async function getTTLockAccountByClient(clientId, ttlockSlotOpt) {
  const ttlockSlot = Number(ttlockSlotOpt ?? 0) || 0;
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
       WHERE clientdetail_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1 AND slot = ?
       LIMIT 1`,
      [String(clientId), ttlockSlot]
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
       WHERE operator_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock' AND enabled = 1 AND COALESCE(slot, 0) = ?
       LIMIT 1`,
      [String(clientId), ttlockSlot]
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

/** Idempotent: multi-slot operator tokens (migration 0280). Safe to call repeatedly. */
let clnTtlocktokenOperatorSlotEnsured = false;
async function ensureClnTtlocktokenOperatorSlotUnique() {
  if (clnTtlocktokenOperatorSlotEnsured) return;
  try {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_ttlocktoken'`
    );
    if (!row || Number(row.c) === 0) return;
  } catch {
    return;
  }
  try {
    const [[col]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_ttlocktoken' AND COLUMN_NAME = 'slot'`
    );
    if (!col || Number(col.c) === 0) {
      await pool.query('ALTER TABLE cln_ttlocktoken ADD COLUMN slot INT NOT NULL DEFAULT 0 AFTER operator_id');
    }
  } catch (e) {
    console.warn('[ttlockToken] ensure operator slot column', e?.message || e);
  }
  try {
    const [[uq]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_operator'`
    );
    if (uq && Number(uq.c) > 0) {
      await pool.query('ALTER TABLE cln_ttlocktoken DROP INDEX uq_cln_ttlocktoken_operator');
    }
  } catch (e) {
    console.warn('[ttlockToken] drop uq_cln_ttlocktoken_operator', e?.message || e);
  }
  try {
    const [[uq2]] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cln_ttlocktoken' AND INDEX_NAME = 'uq_cln_ttlocktoken_operator_slot'`
    );
    if (!uq2 || Number(uq2.c) === 0) {
      await pool.query(
        'ALTER TABLE cln_ttlocktoken ADD UNIQUE KEY uq_cln_ttlocktoken_operator_slot (operator_id, slot)'
      );
    }
  } catch (e) {
    console.warn('[ttlockToken] add uq_cln_ttlocktoken_operator_slot', e?.message || e);
  }
  clnTtlocktokenOperatorSlotEnsured = true;
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

async function saveTokenClnScoped(clientId, scope, data, ttlockSlot = 0) {
  const accessToken = data.access_token;
  const refreshTokenVal = data.refresh_token ?? null;
  const expiresIn = data.expires_in ?? 0;
  const clientdetailId = scope === 'cln_clientdetail' ? clientId : null;
  const operatorId = scope === 'cln_operatordetail' ? clientId : null;
  const slot = Number(ttlockSlot) || 0;
  if (scope === 'cln_operatordetail') {
    await ensureClnTtlocktokenOperatorSlotUnique();
  }

  let existing;
  try {
    if (clientdetailId) {
      const [rows] = await pool.query(
        'SELECT id FROM cln_ttlocktoken WHERE clientdetail_id = ? AND slot = ? LIMIT 1',
        [clientId, slot]
      );
      existing = rows;
    } else {
      const [rows] = await pool.query(
        'SELECT id FROM cln_ttlocktoken WHERE operator_id = ? AND slot = ? LIMIT 1',
        [clientId, slot]
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
    `INSERT INTO cln_ttlocktoken (id, clientdetail_id, operator_id, slot, accesstoken, refreshtoken, expiresin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
    [id, clientdetailId, operatorId, slot, accessToken, refreshTokenVal, expiresIn]
  );
}

/**
 * Save or update token. Routes to `ttlocktoken` (Coliving operatordetail) or `cln_ttlocktoken` (Cleanlemons).
 * @param {object} [opts] - `{ slot }` for Cleanlemons multi-account (default slot 0).
 */
async function saveToken(clientId, data, opts = {}) {
  const cid = String(clientId || '').trim();
  const scope = await detectTtlockTokenScope(cid);
  if (scope === 'operatordetail') {
    await saveTokenOperatordetail(cid, data);
    return;
  }
  if (scope === 'cln_clientdetail' || scope === 'cln_operatordetail') {
    const slot = Number(opts?.slot) || 0;
    await saveTokenClnScoped(cid, scope, data, slot);
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

async function readStoredTtlockTokenRow(clientId, ttlockSlotOpt) {
  const cid = String(clientId || '').trim();
  const slot = Number(ttlockSlotOpt ?? 0) || 0;
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
        'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM cln_ttlocktoken WHERE clientdetail_id = ? AND slot = ? LIMIT 1',
        [cid, slot]
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
      await ensureClnTtlocktokenOperatorSlotUnique();
      const [rows] = await pool.query(
        'SELECT accesstoken, refreshtoken, expiresin, updated_at FROM cln_ttlocktoken WHERE operator_id = ? AND slot = ? LIMIT 1',
        [cid, slot]
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
async function getValidTTLockToken(clientId, opts) {
  const slot = opts && opts.slot != null ? Number(opts.slot) || 0 : 0;
  const { scope, row } = await readStoredTtlockTokenRow(clientId, slot);

  if (row) {
    const updatedAt = new Date(row.updated_at).getTime();
    const expiresMs = (row.expiresin || 0) * 1000;
    if (Date.now() < updatedAt + expiresMs - BUFFER_MS) {
      return normalizeToken(row);
    }
    if (row.refreshtoken) {
      const refreshed = await refreshToken(row.refreshtoken);
      if (refreshed.access_token) {
        await saveToken(clientId, refreshed, { slot });
        return normalizeToken(refreshed);
      }
    }
  }

  const account = await getTTLockAccountByClient(clientId, slot);
  const fresh = await requestNewToken(account);
  await saveToken(clientId, fresh, { slot });
  return normalizeToken(fresh);
}

module.exports = {
  getValidTTLockToken,
  getTTLockAccountByClient,
  requestNewToken,
  refreshToken,
  saveToken
};
