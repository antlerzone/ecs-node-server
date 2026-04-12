/**
 * CNYIoT token (per client, SaaS).
 * Uses cnyiottokens table and client_integration (key=meter, provider=cnyiot) for credentials.
 * 直连官方 API https://www.openapi.cnyiot.com/api.ashx；可覆盖 env CNYIOT_BASE_URL。
 * Login; token cached 24h then re-login.
 */

const crypto = require('crypto');
const pool = require('../../../config/db');

const BASE_URL = process.env.CNYIOT_BASE_URL || 'https://www.openapi.cnyiot.com/api.ashx';
const LOGIN_URL = `${BASE_URL}?Method=login&api=${process.env.CNYIOT_API_ID || 'coliman'}`;
const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** In-memory cache for platform (mother) account token. Used when creating subusers. */
let platformTokenCache = null;

/**
 * Get platform (mother) account from Secret Manager / env: CNYIOT_LOGIN_NAME, CNYIOT_LOGIN_PSW.
 * Used to call addUser/getUsers when creating a subuser for a client.
 */
function getCnyIotPlatformAccount() {
  const username = process.env.CNYIOT_LOGIN_NAME && String(process.env.CNYIOT_LOGIN_NAME).trim();
  const password = process.env.CNYIOT_LOGIN_PSW && String(process.env.CNYIOT_LOGIN_PSW).trim();
  if (!username || !password) throw new Error('CNYIOT_PLATFORM_ACCOUNT_MISSING');
  return { username, password };
}

/**
 * Get valid token for platform account (cached in memory, 24h).
 * Use this when creating subusers so we don't require client to have saved credentials.
 */
async function getValidCnyIotTokenForPlatform() {
  if (platformTokenCache && Date.now() < platformTokenCache.updatedAt + TOKEN_MAX_AGE_MS) {
    console.log('[CNYIOT] platform token from cache');
    return { apiKey: platformTokenCache.apiKey, loginID: platformTokenCache.loginID };
  }
  console.log('[CNYIOT] platform token requestNewToken start');
  const t0 = Date.now();
  const account = getCnyIotPlatformAccount();
  const fresh = await requestNewToken(account);
  console.log('[CNYIOT] platform token requestNewToken done ms=%s', Date.now() - t0);
  platformTokenCache = {
    apiKey: fresh.apiKey,
    loginID: fresh.loginID,
    updatedAt: Date.now()
  };
  return { apiKey: fresh.apiKey, loginID: fresh.loginID };
}

/** Clear platform token cache (e.g. on 5002 retry). */
function invalidateCnyIotPlatformToken() {
  platformTokenCache = null;
}

/**
 * Get CNYIoT account (username/password) for client from client_integration.
 * 有子账号时优先用子账号登录（cnyiot_subuser_login + cnyiot_subuser_password），否则用 cnyiot_username / cnyiot_password。
 */
async function getCnyIotAccountByClient(clientId) {
  console.log('[CNYIOT] getCnyIotAccountByClient clientId=%s', clientId);
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'meter' AND provider = 'cnyiot' AND enabled = 1
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) {
    const [anyRows] = await pool.query(
      `SELECT id, client_id, \`key\`, provider, enabled, LEFT(COALESCE(values_json, '{}'), 300) AS values_preview FROM client_integration WHERE client_id = ? LIMIT 5`,
      [clientId]
    );
    console.log('[CNYIOT] getCnyIotAccountByClient no row for client_id=%s key=meter provider=cnyiot enabled=1. Other rows for this client: count=%s rows=%j', clientId, anyRows.length, anyRows);
    throw new Error('CNYIOT_NOT_CONFIGURED');
  }
  const raw = rows[0].values_json;
  const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const keys = values && typeof values === 'object' ? Object.keys(values) : [];
  const subuserLogin = values?.cnyiot_subuser_login;
  const subuserPsw = values?.cnyiot_subuser_password;
  const mainUsername = values?.cnyiot_username;
  const mainPassword = values?.cnyiot_password;
  const useSubuser = subuserLogin && subuserPsw;
  const username = useSubuser ? subuserLogin : mainUsername;
  const password = useSubuser ? subuserPsw : mainPassword;
  console.log('[CNYIOT] getCnyIotAccountByClient clientId=%s integration_id=%s useSubuser=%s login=%s', clientId, rows[0].id, !!useSubuser, username ? `${String(username).slice(0, 6)}***` : null);
  if (!username || !password) {
    console.log('[CNYIOT] getCnyIotAccountByClient CNYIOT_ACCOUNT_INVALID username=%s password_set=%s', !!username, !!password);
    throw new Error('CNYIOT_ACCOUNT_INVALID');
  }
  return { username, password };
}

const LOGIN_FETCH_TIMEOUT_MS = Number(process.env.CNYIOT_FETCH_TIMEOUT_MS) || 25000;

/**
 * Login to CNYIoT API; returns { apiKey, loginID }.
 */
async function requestNewToken({ username, password }) {
  const body = { nam: username, psw: password };
  const payloadForLog = { nam: username || '(empty)', psw: password ? '***' : '(empty)' };
  console.log('[CNYIOT] login request start url=%s payload=%j', LOGIN_URL.replace(/apiKey=.*/, 'apiKey=***'), payloadForLog);
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOGIN_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('[CNYIOT] login fetch failed ms=%s err=%s cause=%s', Date.now() - t0, e?.message, e?.cause);
    if (e?.name === 'AbortError' || e?.cause?.name === 'AbortError') throw new Error('CNYIOT_NETWORK_TIMEOUT');
    throw e;
  }
  clearTimeout(timeoutId);
  const text = await res.text();
  console.log('[CNYIOT] login response status=%s ms=%s textLen=%s', res.status, Date.now() - t0, (text && text.length) || 0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('[CNYIOT] login non-JSON text=%s', text.slice(0, 200));
    throw new Error('CNYIOT_LOGIN_NON_JSON');
  }
  const apiKey = json?.value?.apiKey;
  const loginID = json?.value?.LoginID ?? json?.value?.loginid;
  if (!apiKey || !loginID) {
    const resultCode = json?.result ?? 'unknown';
    const msg = json?.message ?? json?.msg ?? '';
    console.error('[CNYIOT] login failed result=%s message=%s full=%j', resultCode, msg, json);
    if (Number(resultCode) === 4006) {
      console.error('[CNYIOT] 4006 = 密码错误 (editPsw). 请检查 client_integration 中该户的 cnyiot_username / cnyiot_password。');
    }
    throw new Error(`CNYIOT_LOGIN_FAILED:${resultCode}`);
  }
  return { apiKey, loginID };
}

/**
 * Save or update token for client in cnyiottokens.
 * DB columns: apikey, loginid
 */
async function saveToken(clientId, data) {
  const id = crypto.randomUUID();
  const [existing] = await pool.query(
    'SELECT id FROM cnyiottokens WHERE client_id = ? LIMIT 1',
    [clientId]
  );
  if (existing.length > 0) {
    await pool.query(
      'UPDATE cnyiottokens SET apikey = ?, loginid = ?, updated_at = NOW() WHERE client_id = ?',
      [data.apiKey, data.loginID, clientId]
    );
    return;
  }
  await pool.query(
    `INSERT INTO cnyiottokens (id, client_id, apikey, loginid, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [id, clientId, data.apiKey, data.loginID]
  );
}

/**
 * Invalidate token for client (delete row). Called when API returns 5002.
 */
async function invalidateCnyIotToken(clientId) {
  await pool.query('DELETE FROM cnyiottokens WHERE client_id = ?', [clientId]);
}

/**
 * Get valid token for client (from cache if fresh, else login).
 * @returns {{ apiKey: string, loginID: string }}
 */
async function getValidCnyIotToken(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');
  console.log('[CNYIOT] getValidCnyIotToken clientId=%s', clientId);

  const [rows] = await pool.query(
    'SELECT apikey, loginid, updated_at FROM cnyiottokens WHERE client_id = ? LIMIT 1',
    [clientId]
  );

  if (rows.length > 0) {
    const row = rows[0];
    const updatedAt = new Date(row.updated_at).getTime();
    if (Date.now() < updatedAt + TOKEN_MAX_AGE_MS) {
      console.log('[CNYIOT] getValidCnyIotToken clientId=%s using cached token', clientId);
      return {
        apiKey: row.apikey,
        loginID: row.loginid
      };
    }
  }

  console.log('[CNYIOT] getValidCnyIotToken clientId=%s no valid cache, fetching account and login', clientId);
  const account = await getCnyIotAccountByClient(clientId);
  const fresh = await requestNewToken(account);
  await saveToken(clientId, fresh);
  return { apiKey: fresh.apiKey, loginID: fresh.loginID };
}

module.exports = {
  getValidCnyIotToken,
  getValidCnyIotTokenForPlatform,
  getCnyIotAccountByClient,
  getCnyIotPlatformAccount,
  requestNewToken,
  saveToken,
  invalidateCnyIotToken,
  invalidateCnyIotPlatformToken
};
