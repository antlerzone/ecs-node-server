/**
 * Clean Lemons integrations: operator scope in cln_operator_integration (Bukku, Xero, Drive, …);
 * B2B client (building customer) scope in cln_client_integration — TTLock, Coliving bridge, etc.
 */

const crypto = require('crypto');
const { randomUUID, randomBytes } = crypto;
const { google } = require('googleapis');
const axios = require('axios');
const pool = require('../../config/db');

const KEY_ADDON = 'addonAccount';
const KEY_STORAGE = 'storage';
const KEY_AI = 'aiAgent';
const KEY_STRIPE_CONNECT = 'stripeConnect';
const KEY_SMART_DOOR = 'smartDoor';
const PROVIDER_BUKKU = 'bukku';
const PROVIDER_XERO = 'xero';
const PROVIDER_GOOGLE_DRIVE = 'google_drive';
const PROVIDER_STRIPE_OAUTH = 'oauth';
const PROVIDER_TTLOCK = 'ttlock';
const KEY_THIRD_PARTY_INTEGRATION = 'thirdPartyIntegration';
const PROVIDER_STATIC_TOKEN = 'static_token';
const { requestNewToken, saveToken } = require('../ttlock/lib/ttlockToken.service');
const AI_PROVIDERS = ['openai', 'deepseek', 'gemini'];

function getCleanlemonXeroClientId() {
  return (process.env.CLEANLEMON_XERO_CLIENT_ID || process.env.XERO_CLIENT_ID || '').trim();
}

function getCleanlemonXeroClientSecret() {
  return (process.env.CLEANLEMON_XERO_CLIENT_SECRET || process.env.XERO_CLIENT_SECRET || '').trim();
}

async function ensureClnOperatorIntegrationTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_operator_integration (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      operator_id VARCHAR(64) NOT NULL,
      \`key\` VARCHAR(64) NOT NULL,
      version INT NOT NULL DEFAULT 1,
      slot INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      provider VARCHAR(64) NOT NULL,
      values_json LONGTEXT NOT NULL,
      einvoice TINYINT(1) NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_cln_operator_integration (operator_id, \`key\`, provider)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function ensureClnClientIntegrationTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cln_client_integration (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      clientdetail_id CHAR(36) NOT NULL,
      \`key\` VARCHAR(64) NOT NULL,
      version INT NOT NULL DEFAULT 1,
      slot INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 0,
      provider VARCHAR(64) NOT NULL,
      values_json LONGTEXT NOT NULL,
      einvoice TINYINT(1) NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_cln_client_integration_slot (clientdetail_id, \`key\`, provider, slot),
      KEY idx_cln_client_integration_clientdetail (clientdetail_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

function getTokenSecret() {
  return (process.env.GOOGLE_DRIVE_OAUTH_TOKEN_SECRET || '').trim() || null;
}

function getStateSecret() {
  return (
    (process.env.GOOGLE_DRIVE_OAUTH_STATE_SECRET || '').trim() ||
    getTokenSecret() ||
    (process.env.GOOGLE_CLIENT_SECRET || '').trim() ||
    (process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET || '').trim() ||
    ''
  );
}

function getDriveOAuthClientId() {
  return (
    (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || '').trim() ||
    (process.env.CLEANLEMON_GOOGLE_CLIENT_ID || '').trim() ||
    (process.env.GOOGLE_CLIENT_ID || '').trim()
  );
}

function getDriveOAuthClientSecret() {
  return (
    (process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || '').trim() ||
    (process.env.CLEANLEMON_GOOGLE_CLIENT_SECRET || '').trim() ||
    (process.env.GOOGLE_CLIENT_SECRET || '').trim()
  );
}

function getCleanlemonGoogleDriveRedirectUri() {
  const u = (process.env.CLEANLEMON_GOOGLE_DRIVE_OAUTH_REDIRECT_URI || '').trim();
  if (u) return u;
  const base = (process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (base) return `${base}/api/cleanlemon/operator/google-drive/oauth-callback`;
  return '';
}

function getCleanlemonPortalCompanyUrl() {
  const explicit = (process.env.CLEANLEMON_PORTAL_COMPANY_URL || '').trim();
  if (explicit) return explicit;
  const portal = (process.env.CLEANLEMON_PORTAL_AUTH_BASE_URL || process.env.PORTAL_APP_URL || '').trim().replace(/\/+$/, '');
  if (portal) return `${portal}/portal/operator/company`;
  return 'https://portal.cleanlemons.com/portal/operator/company';
}

/** Stripe Connect OAuth `redirect_uri` — must match Stripe Dashboard → Connect → Redirect URIs (no query string). */
function getCleanlemonStripeConnectRedirectUri() {
  let u = (process.env.CLEANLEMON_STRIPE_CONNECT_OAUTH_REDIRECT_URI || '').trim();
  if (u) return u.replace(/\?.*$/, '').replace(/\/+$/, '');
  const base = (process.env.API_BASE_URL || process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/api/cleanlemon/operator/stripe-connect/oauth-callback`;
  return 'https://api.cleanlemons.com/api/cleanlemon/operator/stripe-connect/oauth-callback';
}

function getCleanlemonStripeConnectClientId() {
  return (
    process.env.CLEANLEMON_STRIPE_SANDBOX_CONNECT_CLIENT_ID ||
    process.env.CLEANLEMON_STRIPE_CONNECT_CLIENT_ID ||
    ''
  )
    .trim()
    .replace(/\?.*$/, '');
}

async function getStripeConnectOAuthAuthUrl(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) return { ok: false, reason: 'MISSING_OPERATOR_ID' };
  const clientId = getCleanlemonStripeConnectClientId();
  if (!clientId) return { ok: false, reason: 'CLEANLEMON_STRIPE_CONNECT_CLIENT_ID_NOT_SET' };
  const redirectUri = getCleanlemonStripeConnectRedirectUri();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state: oid
  });
  return {
    ok: true,
    url: `https://connect.stripe.com/oauth/authorize?${params.toString()}`,
    redirectUri
  };
}

async function completeOperatorStripeConnectOAuth(operatorId, code) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  if (!code || !String(code).trim()) throw new Error('STRIPE_OAUTH_CODE_REQUIRED');
  const secret = (
    process.env.CLEANLEMON_STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET_KEY ||
    ''
  ).trim();
  if (!secret) throw new Error('CLEANLEMON_STRIPE_SECRET_KEY_NOT_SET');
  const body = new URLSearchParams({
    client_secret: secret,
    code: String(code).trim(),
    grant_type: 'authorization_code'
  }).toString();
  const res = await axios
    .post('https://connect.stripe.com/oauth/token', body, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    .catch((err) => {
      const d = err.response?.data;
      throw new Error(d?.error_description || d?.error || err.message || 'STRIPE_OAUTH_TOKEN_FAILED');
    });
  const accountId = res.data?.stripe_user_id || res.data?.stripe_account_id;
  if (!accountId) throw new Error('STRIPE_OAUTH_NO_ACCOUNT_ID');
  await upsertClnOperatorIntegration(
    oid,
    KEY_STRIPE_CONNECT,
    0,
    PROVIDER_STRIPE_OAUTH,
    {
      stripe_connected_account_id: String(accountId),
      livemode: Boolean(res.data?.livemode)
    },
    true,
    null
  );
  return { ok: true, accountId: String(accountId) };
}

async function disconnectStripeConnect(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_STRIPE_CONNECT, PROVIDER_STRIPE_OAUTH]
  );
  if (rows.length) {
    await pool.query(
      `UPDATE cln_operator_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify({ stripe_connected_account_id: '', livemode: false }), rows[0].id]
    );
  }
  return { ok: true };
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
    console.warn('[cleanlemon-integration] decryptRefreshToken failed', e?.message || e);
    return null;
  }
}

/** AI / operator secrets: prefer dedicated secret, else same as Drive token secret. */
function deriveOperatorIntegrationAesKey() {
  const secret = (
    process.env.CLEANLEMON_OPERATOR_INTEGRATION_SECRET ||
    process.env.GOOGLE_DRIVE_OAUTH_TOKEN_SECRET ||
    ''
  ).trim();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptOperatorSecret(plain) {
  const key = deriveOperatorIntegrationAesKey();
  if (!key) throw new Error('OPERATOR_INTEGRATION_SECRET_NOT_SET');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptOperatorSecret(b64) {
  const key = deriveOperatorIntegrationAesKey();
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
    console.warn('[cleanlemon-integration] decryptOperatorSecret failed', e?.message || e);
    return null;
  }
}

function signDriveState(payload) {
  const secret = getStateSecret();
  if (!secret) throw new Error('GOOGLE_DRIVE_OAUTH_STATE_OR_TOKEN_SECRET_NOT_SET');
  const bodyB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(bodyB64).digest('base64url');
  return `${bodyB64}.${sig}`;
}

function verifyDriveState(s) {
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
  if (!payload.operatorId || !payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

async function upsertClnOperatorIntegration(operatorId, key, slot, provider, valuesMerge, enabled = true, einvoice = null) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id, values_json FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), key, provider]
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
  const en = einvoice === null ? null : einvoice ? 1 : 0;
  if (existing) {
    await pool.query(
      'UPDATE cln_operator_integration SET values_json = ?, enabled = ?, einvoice = COALESCE(?, einvoice), updated_at = NOW() WHERE id = ?',
      [valuesStr, enabled ? 1 : 0, en, existing.id]
    );
    return;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO cln_operator_integration (id, operator_id, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [id, String(operatorId), key, slot, enabled ? 1 : 0, provider, valuesStr, en, now, now]
  );
}

async function upsertClnClientIntegration(clientdetailId, key, slot, provider, valuesMerge, enabled = true, einvoice = null) {
  await ensureClnClientIntegrationTable();
  const cid = String(clientdetailId || '').trim();
  const slotNum = Number(slot) || 0;
  /** Legacy rows may have slot NULL; `slot = 0` misses them and causes duplicate INSERT vs uniq (client,key,provider). */
  const [rows] = await pool.query(
    `SELECT id, values_json FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? AND COALESCE(slot, 0) = ? LIMIT 1`,
    [cid, key, provider, slotNum]
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
  const en = einvoice === null ? null : einvoice ? 1 : 0;
  if (existing) {
    await pool.query(
      'UPDATE cln_client_integration SET values_json = ?, enabled = ?, einvoice = COALESCE(?, einvoice), updated_at = NOW() WHERE id = ?',
      [valuesStr, enabled ? 1 : 0, en, existing.id]
    );
    return;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO cln_client_integration (id, clientdetail_id, \`key\`, version, slot, enabled, provider, values_json, einvoice, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cid, key, slotNum, enabled ? 1 : 0, provider, valuesStr, en, now, now]
  );
}

async function disableAddonAccountProvidersExcept(operatorId, keepProvider) {
  await ensureClnOperatorIntegrationTable();
  await pool.query(
    `UPDATE cln_operator_integration SET enabled = 0, updated_at = NOW()
     WHERE operator_id = ? AND \`key\` = ? AND provider != ?`,
    [String(operatorId), KEY_ADDON, keepProvider]
  );
}

async function disableAiProvidersExcept(operatorId, keepProvider) {
  await ensureClnOperatorIntegrationTable();
  await pool.query(
    `UPDATE cln_operator_integration SET enabled = 0, updated_at = NOW()
     WHERE operator_id = ? AND \`key\` = ? AND provider != ?`,
    [String(operatorId), KEY_AI, keepProvider]
  );
}

/**
 * Flags merged into GET /operator/settings (credential-backed).
 */
async function getIntegrationFlagsForOperator(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT \`key\`, provider, enabled, values_json FROM cln_operator_integration WHERE operator_id = ?`,
    [String(operatorId)]
  );
  let bukku = false;
  let xero = false;
  let googleDrive = false;
  let googleDriveEmail;
  let ai = false;
  let aiProvider = null;
  let aiKeyConfigured = false;
  let stripeMerchant = false;
  let ttlockConnected = false;
  let ttlockCreateEverUsed = false;
  for (const r of rows) {
    const en = Number(r.enabled) === 1;
    let v = r.values_json;
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v || '{}');
      } catch {
        v = {};
      }
    } else v = v || {};
    if (r.key === KEY_ADDON && r.provider === PROVIDER_BUKKU && en && (v.bukku_secretKey || v.bukku_token)) {
      bukku = true;
    }
    if (r.key === KEY_ADDON && r.provider === PROVIDER_XERO && en && v.xero_access_token && v.xero_tenant_id) {
      xero = true;
    }
    if (r.key === KEY_STORAGE && r.provider === PROVIDER_GOOGLE_DRIVE && en && v.refresh_token_enc) {
      googleDrive = true;
      googleDriveEmail = v.google_email ? String(v.google_email) : undefined;
    }
    if (r.key === KEY_AI && en) {
      const dec = v.api_key_enc ? decryptOperatorSecret(v.api_key_enc) : '';
      if (dec && String(dec).trim()) {
        ai = true;
        aiProvider = String(r.provider || '').trim().toLowerCase();
        aiKeyConfigured = true;
      }
    }
    if (
      r.key === KEY_STRIPE_CONNECT &&
      r.provider === PROVIDER_STRIPE_OAUTH &&
      en &&
      v.stripe_connected_account_id &&
      String(v.stripe_connected_account_id).trim()
    ) {
      stripeMerchant = true;
    }
    if (r.key === KEY_SMART_DOOR && r.provider === PROVIDER_TTLOCK) {
      if (en && v.ttlock_username && v.ttlock_password) ttlockConnected = true;
      if (v.ttlock_subuser_ever_created) ttlockCreateEverUsed = true;
    }
  }
  try {
    await ensureClnClientIntegrationTable();
    const [clientTtRows] = await pool.query(
      `SELECT i.enabled, i.values_json
       FROM cln_client_integration i
       INNER JOIN cln_client_operator j ON j.clientdetail_id = i.clientdetail_id
       WHERE j.operator_id = ? AND i.\`key\` = ? AND i.provider = ?`,
      [String(operatorId), KEY_SMART_DOOR, PROVIDER_TTLOCK]
    );
    for (const r of clientTtRows) {
      const en = Number(r.enabled) === 1;
      let v = r.values_json;
      if (typeof v === 'string') {
        try {
          v = JSON.parse(v || '{}');
        } catch {
          v = {};
        }
      } else v = v || {};
      if (en && v.ttlock_username && v.ttlock_password) ttlockConnected = true;
      if (v.ttlock_subuser_ever_created) ttlockCreateEverUsed = true;
    }
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/doesn't exist/i.test(msg) && !/Unknown table/i.test(msg)) throw e;
  }
  return {
    bukku,
    xero,
    googleDrive,
    googleDriveEmail,
    ai,
    aiProvider,
    aiKeyConfigured,
    stripeMerchant,
    ttlockConnected,
    ttlockCreateEverUsed
  };
}

async function bukkuConnect(operatorId, { token, subdomain, einvoice }) {
  if (!token || !subdomain) throw new Error('TOKEN_AND_SUBDOMAIN_REQUIRED');
  await disableAddonAccountProvidersExcept(operatorId, PROVIDER_BUKKU);
  await upsertClnOperatorIntegration(
    operatorId,
    KEY_ADDON,
    0,
    PROVIDER_BUKKU,
    {
      bukku_secretKey: String(token).trim(),
      bukku_subdomain: String(subdomain).trim()
    },
    true,
    einvoice
  );
  return { ok: true };
}

async function getBukkuCredentials(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = ? AND provider = ? AND enabled = 1 LIMIT 1`,
    [String(operatorId), KEY_ADDON, PROVIDER_BUKKU]
  );
  if (!rows.length) return { ok: true, token: '', subdomain: '' };
  const raw = rows[0].values_json;
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  return {
    ok: true,
    token: v.bukku_secretKey ?? v.bukku_token ?? '',
    subdomain: v.bukku_subdomain ?? ''
  };
}

async function bukkuDisconnect(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_ADDON, PROVIDER_BUKKU]
  );
  if (rows.length) {
    const valuesJson = JSON.stringify({ bukku_secretKey: '', bukku_subdomain: '' });
    await pool.query(
      'UPDATE cln_operator_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      [valuesJson, rows[0].id]
    );
  }
  return { ok: true };
}

async function xeroConnect(operatorId, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('XERO_PAYLOAD_REQUIRED');
  const code = payload.code;
  const redirectUri = payload.redirectUri || payload.redirect_uri;

  if (code && redirectUri) {
    const clientIdEnv = getCleanlemonXeroClientId();
    const clientSecret = getCleanlemonXeroClientSecret();
    if (!clientIdEnv || !clientSecret) throw new Error('XERO_APP_CREDENTIALS_MISSING');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    }).toString();
    const res = await axios
      .post('https://identity.xero.com/connect/token', body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientIdEnv}:${clientSecret}`).toString('base64')}`
        }
      })
      .catch((err) => {
        const xeroMsg = err.response?.data?.error_description || err.response?.data?.error || err.message;
        if (err.response?.status === 400) console.log('[cleanlemon-xero] token 400', err.response?.data);
        throw new Error(xeroMsg || 'XERO_TOKEN_EXCHANGE_FAILED');
      });
    const data = res.data;
    let tenantId = data.tenant_id || (Array.isArray(data.tenants) && data.tenants[0]?.id) || null;
    if (!tenantId && data.access_token) {
      const connRes = await axios
        .get('https://api.xero.com/connections', {
          headers: { Authorization: `Bearer ${data.access_token}` }
        })
        .catch(() => null);
      if (connRes?.data?.[0]?.tenantId) tenantId = connRes.data[0].tenantId;
    }
    if (!tenantId) throw new Error('XERO_TENANT_ID_REQUIRED');
    await disableAddonAccountProvidersExcept(operatorId, PROVIDER_XERO);
    await upsertClnOperatorIntegration(
      operatorId,
      KEY_ADDON,
      0,
      PROVIDER_XERO,
      {
        xero_access_token: data.access_token,
        xero_refresh_token: data.refresh_token || null,
        xero_expires_at: new Date(Date.now() + (data.expires_in || 1800) * 1000).toISOString(),
        xero_tenant_id: tenantId
      },
      true
    );
    return { ok: true, tenantId };
  }

  const access_token = payload.access_token || payload.accessToken;
  const refresh_token = payload.refresh_token || payload.refreshToken;
  const expires_in = payload.expires_in ?? payload.expiresIn;
  const tenant_id = payload.tenant_id || payload.tenantId;
  if (!access_token || !tenant_id) throw new Error('XERO_ACCESS_TOKEN_AND_TENANT_ID_REQUIRED');
  await disableAddonAccountProvidersExcept(operatorId, PROVIDER_XERO);
  await upsertClnOperatorIntegration(
    operatorId,
    KEY_ADDON,
    0,
    PROVIDER_XERO,
    {
      xero_access_token: access_token,
      xero_refresh_token: refresh_token || null,
      xero_expires_at: expires_in
        ? new Date(Date.now() + (typeof expires_in === 'number' ? expires_in : 1800) * 1000).toISOString()
        : null,
      xero_tenant_id: tenant_id
    },
    true
  );
  return { ok: true, tenantId: tenant_id };
}

function getXeroAuthUrl(redirectUri, state = '') {
  const clientId = getCleanlemonXeroClientId();
  if (!clientId) throw new Error('XERO_APP_CREDENTIALS_MISSING');
  // Apps created on/after 2026-03-02: broad `accounting.transactions` is invalid; use granular scopes
  // (see https://developer.xero.com/faq/granular-scopes and devblog scope migration).
  const defaultScopes =
    'openid profile email accounting.invoices accounting.payments accounting.contacts accounting.settings offline_access';
  const scope = String(process.env.CLEANLEMON_XERO_OAUTH_SCOPES || defaultScopes).trim() || defaultScopes;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope
  });
  if (state) params.set('state', state);
  return { url: `https://login.xero.com/identity/connect/authorize?${params.toString()}` };
}

async function xeroDisconnect(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_ADDON, PROVIDER_XERO]
  );
  if (rows.length) {
    await pool.query('UPDATE cln_operator_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  return { ok: true };
}

async function getGoogleDriveOAuthAuthUrl(operatorId) {
  const clientIdEnv = getDriveOAuthClientId();
  const clientSecret = getDriveOAuthClientSecret();
  if (!clientIdEnv || !clientSecret) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED' };
  }
  if (!getTokenSecret()) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_TOKEN_SECRET_NOT_SET' };
  }
  const redirectUri = getCleanlemonGoogleDriveRedirectUri();
  if (!redirectUri) {
    return { ok: false, reason: 'GOOGLE_DRIVE_OAUTH_REDIRECT_NOT_CONFIGURED' };
  }
  let state;
  try {
    state = signDriveState({
      operatorId: String(operatorId),
      exp: Date.now() + 15 * 60 * 1000
    });
  } catch (e) {
    console.error('[cleanlemon-integration] signDriveState', e?.message || e);
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

async function completeGoogleDriveOAuthFromCallback(code, stateParam) {
  const base = getCleanlemonPortalCompanyUrl();
  const sep = base.includes('?') ? '&' : '?';
  const fail = (reason) => ({ redirectUrl: `${base}${sep}google_drive=error&reason=${encodeURIComponent(reason)}` });
  const okRedirect = { redirectUrl: `${base}${sep}google_drive=connected` };

  if (!code || !stateParam) return fail('missing_params');
  const payload = verifyDriveState(String(stateParam));
  if (!payload) return fail('invalid_state');

  const clientIdEnv = getDriveOAuthClientId();
  const clientSecret = getDriveOAuthClientSecret();
  const redirectUri = getCleanlemonGoogleDriveRedirectUri();
  if (!clientIdEnv || !clientSecret || !redirectUri) return fail('server_config');

  const oauth2Client = new google.auth.OAuth2(clientIdEnv, clientSecret, redirectUri);
  let tokens;
  try {
    const tr = await oauth2Client.getToken(code);
    tokens = tr.tokens;
  } catch (e) {
    console.error('[cleanlemon-integration] getToken failed', e?.message || e);
    return fail('token_exchange');
  }
  if (!tokens.refresh_token) {
    console.warn('[cleanlemon-integration] no refresh_token (revoke app and reconnect with consent)');
    return fail('no_refresh_token');
  }

  oauth2Client.setCredentials(tokens);
  let googleEmail = null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    googleEmail = data.email || null;
  } catch (e) {
    console.warn('[cleanlemon-integration] userinfo.get failed', e?.message || e);
  }

  try {
    const enc = encryptRefreshToken(tokens.refresh_token);
    await upsertClnOperatorIntegration(
      payload.operatorId,
      KEY_STORAGE,
      0,
      PROVIDER_GOOGLE_DRIVE,
      { refresh_token_enc: enc, google_email: googleEmail },
      true
    );
  } catch (e) {
    console.error('[cleanlemon-integration] save drive tokens failed', e?.message || e);
    return fail('save_failed');
  }

  return okRedirect;
}

async function aiAgentConnect(operatorId, { provider, apiKey }) {
  const p = String(provider || '').trim().toLowerCase();
  if (!AI_PROVIDERS.includes(p)) throw new Error('INVALID_AI_PROVIDER');
  const rawKey = String(apiKey || '').trim();
  if (!rawKey) throw new Error('API_KEY_REQUIRED');
  const { verifyAiProviderKey } = require('../ai-integration/verify-ai-provider-key');
  await verifyAiProviderKey(p, rawKey);
  const enc = encryptOperatorSecret(rawKey);
  await disableAiProvidersExcept(operatorId, p);
  await upsertClnOperatorIntegration(operatorId, KEY_AI, 0, p, { api_key_enc: enc }, true, null);
  return { ok: true };
}

async function aiAgentDisconnect(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ?`,
    [String(operatorId), KEY_AI]
  );
  for (const r of rows) {
    await pool.query(
      `UPDATE cln_operator_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify({ api_key_enc: '' }), r.id]
    );
  }
  return { ok: true };
}

/**
 * Server-side only: decrypted API key for the operator’s active AI provider (if any).
 */
async function getDecryptedAiApiKeyForOperator(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT provider, values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = ? AND enabled = 1 LIMIT 1`,
    [String(operatorId), KEY_AI]
  );
  const row = rows[0];
  if (!row) return null;
  let v = row.values_json;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  } else v = v || {};
  const plain = v.api_key_enc ? decryptOperatorSecret(v.api_key_enc) : '';
  if (!plain || !String(plain).trim()) return null;
  return { provider: String(row.provider || '').trim().toLowerCase(), apiKey: String(plain).trim() };
}

async function disconnectGoogleDrive(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_STORAGE, PROVIDER_GOOGLE_DRIVE]
  );
  if (rows.length) {
    await pool.query('UPDATE cln_operator_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?', [
      JSON.stringify({ refresh_token_enc: '', google_email: '' }),
      rows[0].id
    ]);
  }
  return { ok: true };
}

/**
 * OAuth2 client for Drive/Docs calls (same as Coliving getOAuth2ClientForClient).
 * @param {string} operatorId
 */
async function getOAuth2ClientForOperator(operatorId) {
  if (!operatorId) return null;
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT enabled, values_json FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_STORAGE, PROVIDER_GOOGLE_DRIVE]
  );
  const row = rows[0];
  if (!row || Number(row.enabled) !== 1) return null;
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
  const redirectUri = getCleanlemonGoogleDriveRedirectUri();
  if (!clientIdEnv || !clientSecret || !redirectUri) return null;

  const oauth2Client = new google.auth.OAuth2(clientIdEnv, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

async function getClnTtlockRow(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id, enabled, values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_SMART_DOOR, PROVIDER_TTLOCK]
  );
  if (!rows.length) return null;
  const row = rows[0];
  let v = row.values_json;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  } else v = v || {};
  return { id: row.id, enabled: Number(row.enabled) === 1, values: v };
}

function parseClientTtlockValuesJson(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  } else v = v || {};
  return v;
}

function normalizeTtlockLoginCompare(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * @param {object} v - parsed values_json
 * @param {string|string[]} colivingCandidates - Coliving company TTLock login(s): integration + operatordetail mirror may differ (email vs platform name).
 */
function effectiveTtlockSourceFromValues(v, colivingCandidates) {
  const row = v || {};
  if (row.ttlock_source === 'coliving') return 'coliving';
  const arr = Array.isArray(colivingCandidates)
    ? colivingCandidates
    : colivingCandidates
      ? [colivingCandidates]
      : [];
  const cln = normalizeTtlockLoginCompare(row.ttlock_username);
  if (!cln) return 'manual';
  for (const c of arr) {
    if (normalizeTtlockLoginCompare(c) === cln) return 'coliving';
  }
  return 'manual';
}

async function getClnTtlockRowForClientdetail(clientdetailId, slot = 0) {
  await ensureClnClientIntegrationTable();
  const sl = Number(slot) || 0;
  const [rows] = await pool.query(
    `SELECT id, enabled, values_json, slot FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? AND COALESCE(slot, 0) = ? LIMIT 1`,
    [String(clientdetailId).trim(), KEY_SMART_DOOR, PROVIDER_TTLOCK, sl]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const v = parseClientTtlockValuesJson(row.values_json);
  return { id: row.id, slot: Number(row.slot) || 0, enabled: Number(row.enabled) === 1, values: v };
}

async function listClnClientTtlockIntegrationRows(clientdetailId) {
  await ensureClnClientIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id, slot, enabled, values_json FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? ORDER BY slot ASC`,
    [String(clientdetailId).trim(), KEY_SMART_DOOR, PROVIDER_TTLOCK]
  );
  return rows || [];
}

async function nextAvailableTtlockSlot(clientdetailId) {
  await ensureClnClientIntegrationTable();
  const [rows] = await pool.query(
    `SELECT COALESCE(MAX(COALESCE(slot, 0)), -1) + 1 AS n FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ?`,
    [String(clientdetailId).trim(), KEY_SMART_DOOR, PROVIDER_TTLOCK]
  );
  return Number(rows[0]?.n) || 0;
}

/** Slot 0 has Coliving-synced TTLock with credentials — blocks duplicate Coliving copy unless replace. */
async function getClnClientTtlockSlot0Connected(clientdetailId) {
  const row = await getClnTtlockRowForClientdetail(clientdetailId, 0);
  if (!row || !row.enabled) return false;
  const v = row.values || {};
  return !!(v.ttlock_username && v.ttlock_password);
}

/**
 * Cleanlemons TTLock: operator connects their TTLock Open Platform user (same idea as Coliving company setting).
 * Token persisted in `cln_ttlocktoken.operator_id` (not `ttlocktoken`, which FKs Coliving operatordetail only).
 */
async function ttlockConnectClnOperator(operatorId, { username, password } = {}) {
  const oid = String(operatorId || '').trim();
  const usernameTrim = String(username || '').trim();
  const passwordTrim = String(password || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  if (!usernameTrim || !passwordTrim) throw new Error('TTLOCK_USERNAME_PASSWORD_REQUIRED');
  const freshToken = await requestNewToken({
    username: usernameTrim,
    password: passwordTrim
  });
  await upsertClnOperatorIntegration(
    oid,
    KEY_SMART_DOOR,
    0,
    PROVIDER_TTLOCK,
    {
      ttlock_username: usernameTrim,
      ttlock_password: passwordTrim,
      ttlock_mode: 'existing'
    },
    true,
    null
  );
  await saveToken(oid, freshToken);
  return { ok: true, mode: 'existing', username: usernameTrim };
}

/** Server-side bridge key: Cleanlemons calls Coliving with this (stored plaintext in cln_operator_integration; hash on Coliving in client_integration). */
async function upsertColivingBridgeApiKeyClnOperator(operatorId, apiKeyPlain) {
  const k = String(apiKeyPlain || '').trim();
  if (!k) throw new Error('API_KEY_REQUIRED');
  await upsertClnOperatorIntegration(
    String(operatorId),
    'colivingBridge',
    0,
    'coliving',
    { api_key: k },
    true,
    null
  );
}

/** Bridge API key scoped to B2B client (cln_clientdetail). Merges optional Coliving operator metadata. */
async function upsertColivingBridgeApiKeyClnClientdetail(clientdetailId, apiKeyPlain, colivingMeta = {}) {
  const k = String(apiKeyPlain || '').trim();
  if (!k) throw new Error('API_KEY_REQUIRED');
  const merge = {
    api_key: k,
    ...(colivingMeta && typeof colivingMeta === 'object' ? colivingMeta : {})
  };
  await upsertClnClientIntegration(
    String(clientdetailId).trim(),
    'colivingBridge',
    0,
    'coliving',
    merge,
    true,
    null
  );
}

/** Coliving ↔ Cleanlemons bridge row: which Coliving operatordetail is linked (after confirm). */
async function getColivingBridgeInfoClnClientdetail(clientdetailId) {
  await ensureClnClientIntegrationTable();
  const cid = String(clientdetailId || '').trim();
  if (!cid) return { linked: false };
  const [rows] = await pool.query(
    `SELECT enabled, values_json FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = 'colivingBridge' AND provider = 'coliving' LIMIT 1`,
    [cid]
  );
  if (!rows.length || Number(rows[0].enabled) !== 1) {
    return { linked: false };
  }
  const v = parseClientTtlockValuesJson(rows[0].values_json);
  return {
    linked: true,
    colivingOperatordetailId:
      v.coliving_operatordetail_id != null ? String(v.coliving_operatordetail_id).trim() : '',
    colivingOperatorTitle:
      v.coliving_operator_title != null ? String(v.coliving_operator_title).trim() : '',
    colivingOperatorEmail:
      v.coliving_operator_email != null ? String(v.coliving_operator_email).trim() : ''
  };
}

/**
 * Coliving company TTLock identity: `client_integration` may store platform login; `operatordetail.ttlock_username`
 * may mirror email — both must match Cleanlemons row for "(coliving)" when `ttlock_source` was missing.
 */
async function getColivingOperatordetailTtlockUsernameCandidates(operatordetailId) {
  const oid = String(operatordetailId || '').trim();
  if (!oid) return [];
  const out = [];
  const seen = new Set();
  const push = (s) => {
    const t = s != null ? String(s).trim() : '';
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  const [ttRows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'smartDoor' AND provider = 'ttlock'
     ORDER BY enabled DESC, updated_at DESC LIMIT 1`,
    [oid]
  );
  if (ttRows.length) {
    const v = parseClientTtlockValuesJson(ttRows[0].values_json);
    push(v.ttlock_username);
  }
  try {
    const [[od]] = await pool.query(
      'SELECT ttlock_username FROM operatordetail WHERE id = ? LIMIT 1',
      [oid]
    );
    if (od) push(od.ttlock_username);
  } catch (_) {
    /* column missing on old DB */
  }
  return out;
}

/**
 * Coliving-managed TTLock for B2B client: stored `ttlock_source`, or Coliving bridge is linked and
 * this row's TTLock username matches Coliving's company TTLock (e.g. connected via portal before flag existed).
 */
async function getEffectiveTtlockSourceForClnClientdetail(clientdetailId, valuesParsed) {
  const v = valuesParsed || {};
  if (v.ttlock_source === 'coliving') return 'coliving';
  const bridge = await getColivingBridgeInfoClnClientdetail(String(clientdetailId || '').trim());
  if (!bridge.linked || !bridge.colivingOperatordetailId) return 'manual';
  const candidates = await getColivingOperatordetailTtlockUsernameCandidates(bridge.colivingOperatordetailId);
  return effectiveTtlockSourceFromValues(v, candidates);
}

async function persistClnTtlockSourceColivingIfNeeded(integrationRowId, valuesParsed) {
  const id = String(integrationRowId || '').trim();
  if (!id) return;
  const v = valuesParsed && typeof valuesParsed === 'object' ? { ...valuesParsed } : {};
  if (v.ttlock_source === 'coliving') return;
  const merged = {
    ...v,
    ttlock_source: 'coliving',
    from_coliving: true,
    account_display_name:
      v.account_display_name != null && String(v.account_display_name).trim()
        ? String(v.account_display_name).trim()
        : 'Coliving'
  };
  await pool.query(
    'UPDATE cln_client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(merged), id]
  );
}

/** Disable Coliving→Cleanlemons bridge API key row on the B2B client (operator disconnect from Coliving). */
async function disconnectColivingBridgeClnClientdetail(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) return { ok: true };
  await ensureClnClientIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_client_integration WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [cid, 'colivingBridge', 'coliving']
  );
  if (rows.length) {
    await pool.query(
      'UPDATE cln_client_integration SET enabled = 0, values_json = ?, updated_at = NOW() WHERE id = ?',
      ['{}', rows[0].id]
    );
  }
  return { ok: true };
}

async function ttlockDisconnectClnOperator(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id FROM cln_operator_integration WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [oid, KEY_SMART_DOOR, PROVIDER_TTLOCK]
  );
  if (rows.length) {
    await pool.query('UPDATE cln_operator_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  }
  return { ok: true };
}

async function getTtlockCredentialsClnOperator(operatorId) {
  const row = await getClnTtlockRow(operatorId);
  if (!row || !row.enabled) return { ok: true, username: '', password: '' };
  const u = row.values.ttlock_username != null ? String(row.values.ttlock_username) : '';
  const p = row.values.ttlock_password != null ? String(row.values.ttlock_password) : '';
  return { ok: true, username: u, password: p };
}

async function getTtlockOnboardStatusClnOperator(operatorId) {
  const row = await getClnTtlockRow(operatorId);
  const v = row?.values || {};
  const enabled = !!(row && row.enabled);
  return {
    ttlockConnected: enabled && !!(v.ttlock_username && v.ttlock_password),
    ttlockCreateEverUsed: !!v.ttlock_subuser_ever_created
  };
}

/**
 * Client portal / Coliving link: TTLock per cln_clientdetail (multi `slot`); token in `cln_ttlocktoken` per slot.
 * @param {object} opts
 * @param {string} opts.username
 * @param {string} opts.password
 * @param {number} [opts.slot] - omit for manual → next free slot; Coliving bridge uses slot 0.
 * @param {string} [opts.accountName] - display label (e.g. "Coliving" or user-defined).
 * @param {'coliving'|'manual'} [opts.source] - Coliving-integrated accounts are not manageable from client portal.
 */
async function ttlockConnectClnClientdetail(clientdetailId, opts = {}) {
  const { username, password, slot: slotOpt, accountName, source } = opts;
  const cid = String(clientdetailId || '').trim();
  const usernameTrim = String(username || '').trim();
  const passwordTrim = String(password || '').trim();
  if (!cid) throw new Error('MISSING_CLIENTDETAIL_ID');
  if (!usernameTrim || !passwordTrim) throw new Error('TTLOCK_USERNAME_PASSWORD_REQUIRED');
  const sourceNorm = source === 'coliving' ? 'coliving' : 'manual';
  let slot;
  if (sourceNorm === 'coliving') {
    slot = 0;
  } else if (slotOpt != null && slotOpt !== '') {
    slot = Number(slotOpt);
    if (!Number.isFinite(slot) || slot < 0) throw new Error('INVALID_TTLOCK_SLOT');
  } else {
    slot = await nextAvailableTtlockSlot(cid);
  }
  const nameTrim = String(accountName || '').trim();
  const displayName =
    sourceNorm === 'coliving'
      ? 'Coliving'
      : nameTrim || `TTLock (${slot})`;
  const freshToken = await requestNewToken({
    username: usernameTrim,
    password: passwordTrim
  });
  const ttlockValues = {
    ttlock_username: usernameTrim,
    ttlock_password: passwordTrim,
    ttlock_mode: 'existing',
    ttlock_source: sourceNorm,
    account_display_name: displayName,
    /** Explicit audit flag in JSON (canonical remains `ttlock_source`). */
    from_coliving: sourceNorm === 'coliving'
  };
  await upsertClnClientIntegration(cid, KEY_SMART_DOOR, slot, PROVIDER_TTLOCK, ttlockValues, true, null);
  await saveToken(cid, freshToken, { slot });
  return { ok: true, mode: 'existing', username: usernameTrim, slot, source: sourceNorm, accountName: displayName };
}

/**
 * @param {number} [slot=0]
 * @param {{ force?: boolean }} [options] - `force` allows server-side replace (e.g. Coliving link) even for Coliving-managed row.
 */
async function ttlockDisconnectClnClientdetail(clientdetailId, slot = 0, options = {}) {
  const cid = String(clientdetailId || '').trim();
  const sl = Number(slot) || 0;
  if (!cid) throw new Error('MISSING_CLIENTDETAIL_ID');
  await ensureClnClientIntegrationTable();
  const [rows] = await pool.query(
    `SELECT id, values_json FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? AND COALESCE(slot, 0) = ? LIMIT 1`,
    [cid, KEY_SMART_DOOR, PROVIDER_TTLOCK, sl]
  );
  if (!rows.length) return { ok: true };
  const v = parseClientTtlockValuesJson(rows[0].values_json);
  const src = await getEffectiveTtlockSourceForClnClientdetail(cid, v);
  if (src === 'coliving' && !options.force) {
    const err = new Error('TTLOCK_COLIVING_MANAGED');
    err.code = 'TTLOCK_COLIVING_MANAGED';
    throw err;
  }
  await pool.query('UPDATE cln_client_integration SET enabled = 0, updated_at = NOW() WHERE id = ?', [rows[0].id]);
  try {
    await pool.query('DELETE FROM cln_ttlocktoken WHERE clientdetail_id = ? AND slot = ?', [cid, sl]);
  } catch (e) {
    const msg = String(e?.sqlMessage || e?.message || '');
    if (!/Unknown column/i.test(msg) && !/doesn't exist/i.test(msg)) throw e;
  }
  return { ok: true };
}

async function getTtlockCredentialsClnClientdetail(clientdetailId, slot = 0) {
  const row = await getClnTtlockRowForClientdetail(clientdetailId, slot);
  if (!row || !row.enabled) return { ok: true, username: '', password: '', slot: Number(slot) || 0 };
  const u = row.values.ttlock_username != null ? String(row.values.ttlock_username) : '';
  const p = row.values.ttlock_password != null ? String(row.values.ttlock_password) : '';
  return { ok: true, username: u, password: p, slot: row.slot };
}

async function getTtlockOnboardStatusClnClientdetail(clientdetailId) {
  const list = await listClnClientTtlockIntegrationRows(clientdetailId);
  const cid = String(clientdetailId || '').trim();
  const bridge = await getColivingBridgeInfoClnClientdetail(cid);
  const colivingCandidates =
    bridge.linked && bridge.colivingOperatordetailId
      ? await getColivingOperatordetailTtlockUsernameCandidates(bridge.colivingOperatordetailId)
      : [];
  let ttlockCreateEverUsed = false;
  let ttlockConnected = false;
  const accounts = [];
  for (const r of list) {
    let v = parseClientTtlockValuesJson(r.values_json);
    if (v.ttlock_subuser_ever_created) ttlockCreateEverUsed = true;
    const en = Number(r.enabled) === 1;
    let src = effectiveTtlockSourceFromValues(v, colivingCandidates);
    if (src === 'coliving' && v.ttlock_source !== 'coliving' && r.id) {
      try {
        await persistClnTtlockSourceColivingIfNeeded(r.id, v);
        v = { ...v, ttlock_source: 'coliving', account_display_name: v.account_display_name || 'Coliving' };
      } catch (e) {
        console.warn('[cleanlemon-integration] persistClnTtlockSourceColivingIfNeeded', e?.message || e);
      }
    }
    const hasCreds = !!(v.ttlock_username && v.ttlock_password);
    const connected = en && hasCreds;
    if (connected) ttlockConnected = true;
    const nm = v.account_display_name != null ? String(v.account_display_name).trim() : '';
    accounts.push({
      slot: Number(r.slot) || 0,
      accountName: nm || (src === 'coliving' ? 'Coliving' : ''),
      username: v.ttlock_username != null ? String(v.ttlock_username) : '',
      source: src,
      manageable: src !== 'coliving',
      connected
    });
  }
  return {
    ttlockConnected,
    ttlockCreateEverUsed,
    accounts
  };
}

/**
 * Long-lived token for third-party systems (OTA, partners). One row per operator in cln_operator_integration.
 */
async function getThirdPartyIntegrationApiKeyRow(operatorId) {
  await ensureClnOperatorIntegrationTable();
  const [rows] = await pool.query(
    `SELECT values_json, enabled FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(operatorId), KEY_THIRD_PARTY_INTEGRATION, PROVIDER_STATIC_TOKEN]
  );
  if (!rows.length) return null;
  let v = rows[0].values_json;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  } else v = v || {};
  return { enabled: Number(rows[0].enabled) === 1, values: v };
}

/** B2B client portal — third-party key in cln_client_integration (same scope as TTLock). */
async function getThirdPartyIntegrationApiKeyRowClnClientdetail(clientdetailId) {
  await ensureClnClientIntegrationTable();
  const [rows] = await pool.query(
    `SELECT values_json, enabled FROM cln_client_integration
     WHERE clientdetail_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [String(clientdetailId), KEY_THIRD_PARTY_INTEGRATION, PROVIDER_STATIC_TOKEN]
  );
  if (!rows.length) return null;
  let v = rows[0].values_json;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      v = {};
    }
  } else v = v || {};
  return { enabled: Number(rows[0].enabled) === 1, values: v };
}

function extractApiKeyFromRowValues(values) {
  const v = values || {};
  const k = v.api_key != null ? String(v.api_key).trim() : '';
  return k;
}

async function getOrCreateThirdPartyIntegrationApiKey(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  const row = await getThirdPartyIntegrationApiKeyRow(oid);
  if (row && row.enabled) {
    const k = extractApiKeyFromRowValues(row.values);
    if (k) return { ok: true, apiKey: k, created: false };
  }
  const apiKey = randomBytes(32).toString('base64url');
  await upsertClnOperatorIntegration(oid, KEY_THIRD_PARTY_INTEGRATION, 0, PROVIDER_STATIC_TOKEN, { api_key: apiKey }, true, null);
  return { ok: true, apiKey, created: true };
}

async function rotateThirdPartyIntegrationApiKey(operatorId) {
  const oid = String(operatorId || '').trim();
  if (!oid) throw new Error('MISSING_OPERATOR_ID');
  const apiKey = randomBytes(32).toString('base64url');
  await upsertClnOperatorIntegration(oid, KEY_THIRD_PARTY_INTEGRATION, 0, PROVIDER_STATIC_TOKEN, { api_key: apiKey }, true, null);
  return { ok: true, apiKey };
}

/**
 * Client portal third-party API key — keyed by cln_clientdetail.id.
 * Migrates legacy row if a key was stored in cln_operator_integration under the same id string.
 */
async function getOrCreateThirdPartyIntegrationApiKeyClnClientdetail(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) throw new Error('MISSING_CLIENTDETAIL_ID');
  const row = await getThirdPartyIntegrationApiKeyRowClnClientdetail(cid);
  if (row) {
    const k = extractApiKeyFromRowValues(row.values);
    if (k) return { ok: true, apiKey: k, created: false, clientId: cid };
  }
  const legacy = await getThirdPartyIntegrationApiKeyRow(cid);
  if (legacy) {
    const k = extractApiKeyFromRowValues(legacy.values);
    if (k) {
      await upsertClnClientIntegration(cid, KEY_THIRD_PARTY_INTEGRATION, 0, PROVIDER_STATIC_TOKEN, { api_key: k }, true, null);
      return { ok: true, apiKey: k, created: false, clientId: cid };
    }
  }
  const apiKey = randomBytes(32).toString('base64url');
  await upsertClnClientIntegration(cid, KEY_THIRD_PARTY_INTEGRATION, 0, PROVIDER_STATIC_TOKEN, { api_key: apiKey }, true, null);
  return { ok: true, apiKey, created: true, clientId: cid };
}

async function rotateThirdPartyIntegrationApiKeyClnClientdetail(clientdetailId) {
  const cid = String(clientdetailId || '').trim();
  if (!cid) throw new Error('MISSING_CLIENTDETAIL_ID');
  const apiKey = randomBytes(32).toString('base64url');
  await upsertClnClientIntegration(cid, KEY_THIRD_PARTY_INTEGRATION, 0, PROVIDER_STATIC_TOKEN, { api_key: apiKey }, true, null);
  return { ok: true, apiKey, clientId: cid };
}

module.exports = {
  ensureClnOperatorIntegrationTable,
  ensureClnClientIntegrationTable,
  getIntegrationFlagsForOperator,
  bukkuConnect,
  getBukkuCredentials,
  bukkuDisconnect,
  xeroConnect,
  getXeroAuthUrl,
  xeroDisconnect,
  aiAgentConnect,
  aiAgentDisconnect,
  getDecryptedAiApiKeyForOperator,
  getGoogleDriveOAuthAuthUrl,
  completeGoogleDriveOAuthFromCallback,
  disconnectGoogleDrive,
  getCleanlemonPortalCompanyUrl,
  getCleanlemonGoogleDriveRedirectUri,
  getOAuth2ClientForOperator,
  getCleanlemonStripeConnectRedirectUri,
  getStripeConnectOAuthAuthUrl,
  completeOperatorStripeConnectOAuth,
  disconnectStripeConnect,
  ttlockConnectClnOperator,
  ttlockDisconnectClnOperator,
  getTtlockCredentialsClnOperator,
  getTtlockOnboardStatusClnOperator,
  upsertColivingBridgeApiKeyClnOperator,
  upsertClnClientIntegration,
  ttlockConnectClnClientdetail,
  ttlockDisconnectClnClientdetail,
  getTtlockCredentialsClnClientdetail,
  getTtlockOnboardStatusClnClientdetail,
  getClnClientTtlockSlot0Connected,
  upsertColivingBridgeApiKeyClnClientdetail,
  getColivingBridgeInfoClnClientdetail,
  disconnectColivingBridgeClnClientdetail,
  getOrCreateThirdPartyIntegrationApiKey,
  rotateThirdPartyIntegrationApiKey,
  getOrCreateThirdPartyIntegrationApiKeyClnClientdetail,
  rotateThirdPartyIntegrationApiKeyClnClientdetail
};
