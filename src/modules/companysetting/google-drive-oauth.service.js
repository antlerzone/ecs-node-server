/**
 * Per-client Google Drive OAuth (refresh token) for agreement PDF generation.
 * Stored in client_integration: key=storage, provider=google_drive.
 * Requires env: GOOGLE_DRIVE_OAUTH_TOKEN_SECRET (AES key material for refresh tokens in MySQL).
 * OAuth app credentials: GOOGLE_DRIVE_OAUTH_CLIENT_ID / _SECRET, or fallback to same Web client as portal login:
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 * Optional: GOOGLE_DRIVE_OAUTH_REDIRECT_URI, GOOGLE_DRIVE_OAUTH_STATE_SECRET.
 */

const crypto = require('crypto');
const { randomUUID } = crypto;
const { google } = require('googleapis');
const pool = require('../../config/db');

const STORAGE_KEY = 'storage';
const STORAGE_PROVIDER = 'google_drive';

function getRequireCtx() {
  // Lazy to avoid circular load with companysetting.service
  return require('./companysetting.service').requireCtx;
}

function getTokenSecret() {
  return (process.env.GOOGLE_DRIVE_OAUTH_TOKEN_SECRET || '').trim() || null;
}

function getStateSecret() {
  return (
    (process.env.GOOGLE_DRIVE_OAUTH_STATE_SECRET || '').trim() ||
    getTokenSecret() ||
    (process.env.GOOGLE_CLIENT_SECRET || '').trim() ||
    ''
  );
}

/** Same GCP OAuth Web client as portal (Google login) unless Drive-specific vars are set. */
function getDriveOAuthClientId() {
  return (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
}

function getDriveOAuthClientSecret() {
  return (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

function getGoogleDriveOAuthRedirectUri() {
  const u = (process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI || '').trim();
  if (u) return u;
  const base = (process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/api/companysetting/google-drive/oauth-callback`;
  return '';
}

function getPortalCompanySettingsUrl() {
  const portalBase = process.env.PORTAL_APP_URL && String(process.env.PORTAL_APP_URL).trim();
  return (
    process.env.WIX_COMPANY_SETTING_URL ||
    (portalBase ? `${portalBase.replace(/\/+$/, '')}/operator/company` : null) ||
    'https://portal.colivingjb.com/operator/company'
  );
}

function deriveAesKey() {
  const secret = getTokenSecret();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptRefreshToken(plain) {
  const key = deriveAesKey();
  if (!key) throw new Error('GOOGLE_DRIVE_OAUTH_TOKEN_SECRET_NOT_SET');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptRefreshToken(b64) {
  const key = deriveAesKey();
  if (!key || !b64) return null;
  try {
    const buf = Buffer.from(String(b64), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (e) {
    console.warn('[google-drive-oauth] decryptRefreshToken failed', e?.message || e);
    return null;
  }
}

function signState(payload) {
  const secret = getStateSecret();
  if (!secret) throw new Error('GOOGLE_DRIVE_OAUTH_STATE_OR_TOKEN_SECRET_NOT_SET');
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function verifyState(s) {
  if (!s || typeof s !== 'string') return null;
  const i = s.lastIndexOf('.');
  if (i < 0) return null;
  const bodyB64 = s.slice(0, i);
  const sig = s.slice(i + 1);
  const secret = getStateSecret();
  if (!secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(bodyB64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.clientId || !payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

async function upsertStorageGoogleDrive(clientId, valuesMerge, enabled = true) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [clientId, STORAGE_KEY, STORAGE_PROVIDER]
  );
  const existing = rows[0];
  const prev = existing?.values_json
    ? typeof existing.values_json === 'string'
      ? JSON.parse(existing.values_json)
      : existing.values_json
    : {};
  const values = { ...prev, ...valuesMerge };
  const valuesStr = JSON.stringify(values);
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  if (existing) {
    await pool.query(
      'UPDATE client_integration SET values_json = ?, enabled = ?, updated_at = NOW() WHERE id = ?',
      [valuesStr, enabled ? 1 : 0, existing.id]
    );
    return;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?, NULL, ?, ?)`,
    [id, clientId, STORAGE_KEY, enabled ? 1 : 0, STORAGE_PROVIDER, valuesStr, now, now]
  );
}

/**
 * @param {string} email
 * @param {string|null} clientIdFromReq
 * @returns {Promise<{ ok: true, url: string } | { ok: false, reason: string }>}
 */
async function getGoogleDriveOAuthAuthUrl(email, clientIdFromReq = null) {
  const requireCtx = getRequireCtx();
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);

  const clientIdEnv = getDriveOAuthClientId();
  const clientSecret = getDriveOAuthClientSecret();
  if (!clientIdEnv || !clientSecret) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED' };
  }
  if (!getTokenSecret()) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_TOKEN_SECRET_NOT_SET' };
  }
  const redirectUri = getGoogleDriveOAuthRedirectUri();
  if (!redirectUri) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_REDIRECT_NOT_CONFIGURED' };
  }

  let state;
  try {
    state = signState({
      clientId,
      email: String(email).trim().toLowerCase(),
      exp: Date.now() + 15 * 60 * 1000
    });
  } catch (e) {
    console.error('[google-drive-oauth] signState', e?.message || e);
    return { ok: false, reason: e?.message || 'STATE_SIGN_FAILED' };
  }

  const oauth2Client = new google.auth.OAuth2(clientIdEnv, clientSecret, redirectUri);
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
    ],
    state
  });
  return { ok: true, url };
}

/**
 * @param {string} code
 * @param {string} stateParam
 * @returns {Promise<{ redirectUrl: string }>}
 */
async function completeGoogleDriveOAuthFromCallback(code, stateParam) {
  const base = getPortalCompanySettingsUrl();
  const sep = base.includes('?') ? '&' : '?';
  const fail = (reason) => ({ redirectUrl: `${base}${sep}google_drive=error&reason=${encodeURIComponent(reason)}` });
  const okRedirect = { redirectUrl: `${base}${sep}google_drive=connected` };

  if (!code || !stateParam) return fail('missing_params');
  const payload = verifyState(String(stateParam));
  if (!payload) return fail('invalid_state');

  const clientIdEnv = getDriveOAuthClientId();
  const clientSecret = getDriveOAuthClientSecret();
  const redirectUri = getGoogleDriveOAuthRedirectUri();
  if (!clientIdEnv || !clientSecret || !redirectUri) return fail('server_config');

  const oauth2Client = new google.auth.OAuth2(clientIdEnv, clientSecret, redirectUri);
  let tokens;
  try {
    const tr = await oauth2Client.getToken(code);
    tokens = tr.tokens;
  } catch (e) {
    console.error('[google-drive-oauth] getToken failed', e?.message || e);
    return fail('token_exchange');
  }
  if (!tokens.refresh_token) {
    console.warn('[google-drive-oauth] no refresh_token in response (user may need to revoke app and reconnect with prompt=consent)');
    return fail('no_refresh_token');
  }

  oauth2Client.setCredentials(tokens);
  let googleEmail = null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    googleEmail = data.email || null;
  } catch (e) {
    console.warn('[google-drive-oauth] userinfo.get failed', e?.message || e);
  }

  try {
    const enc = encryptRefreshToken(tokens.refresh_token);
    await upsertStorageGoogleDrive(
      payload.clientId,
      { refresh_token_enc: enc, google_email: googleEmail },
      true
    );
  } catch (e) {
    console.error('[google-drive-oauth] save tokens failed', e?.message || e);
    return fail('save_failed');
  }

  return okRedirect;
}

/**
 * @param {string} email
 * @param {string|null} clientIdFromReq
 */
async function disconnectGoogleDrive(email, clientIdFromReq = null) {
  const requireCtx = getRequireCtx();
  const { clientId } = await requireCtx(email, ['integration', 'admin'], clientIdFromReq);
  await pool.query(
    `UPDATE client_integration SET enabled = 0, values_json = '{}', updated_at = NOW()
     WHERE client_id = ? AND \`key\` = ? AND provider = ?`,
    [clientId, STORAGE_KEY, STORAGE_PROVIDER]
  );
  return { ok: true };
}

/**
 * OAuth2 client with refresh token for this client, or null.
 * @param {string} clientId
 * @returns {Promise<import('google-auth-library').OAuth2Client|null>}
 */
async function getOAuth2ClientForClient(clientId) {
  if (!clientId) return null;
  const [rows] = await pool.query(
    `SELECT enabled, values_json FROM client_integration WHERE client_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [clientId, STORAGE_KEY, STORAGE_PROVIDER]
  );
  const row = rows[0];
  if (!row || row.enabled !== 1) return null;
  let values = row.values_json;
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values || '{}');
    } catch {
      values = {};
    }
  }
  const enc = values?.refresh_token_enc;
  const refreshToken = decryptRefreshToken(enc);
  if (!refreshToken) return null;

  const clientIdEnv = getDriveOAuthClientId();
  const clientSecret = getDriveOAuthClientSecret();
  const redirectUri = getGoogleDriveOAuthRedirectUri();
  if (!clientIdEnv || !clientSecret || !redirectUri) return null;

  const oauth2Client = new google.auth.OAuth2(clientIdEnv, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

module.exports = {
  getGoogleDriveOAuthAuthUrl,
  completeGoogleDriveOAuthFromCallback,
  disconnectGoogleDrive,
  getOAuth2ClientForClient,
  getGoogleDriveOAuthRedirectUri,
  getPortalCompanySettingsUrl
};
