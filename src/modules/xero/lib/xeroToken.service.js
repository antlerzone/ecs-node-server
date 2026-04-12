/**
 * Xero OAuth2 token (per client, SaaS).
 * Uses client_integration (key=addonAccount, provider=xero) for credentials.
 * values_json: xero_access_token, xero_refresh_token, xero_expires_at (ISO string or ms), xero_tenant_id.
 * Env: XERO_CLIENT_ID, XERO_CLIENT_SECRET (Xero app credentials).
 */

const pool = require('../../../config/db');
const axios = require('axios');

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry

/**
 * Get Xero tokens from client_integration for client.
 * @param {string} clientId - operatordetail.id
 * @returns {Promise<{ access_token, refresh_token, expires_at, tenant_id }>}
 */
async function getXeroIntegration(clientId) {
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'xero' AND enabled = 1
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('XERO_NOT_CONFIGURED');
  const raw = rows[0].values_json;
  const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const access_token = values?.xero_access_token;
  const refresh_token = values?.xero_refresh_token;
  const tenant_id = values?.xero_tenant_id;
  if (!access_token || !tenant_id) throw new Error('XERO_NOT_CONFIGURED');
  return {
    access_token,
    refresh_token: refresh_token || null,
    expires_at: values?.xero_expires_at ?? null,
    tenant_id
  };
}

/**
 * Refresh access token. Xero returns new refresh_token; caller must persist it.
 * @param {string} refreshToken
 * @returns {Promise<{ access_token, refresh_token, expires_in, tenant_id? }>}
 */
async function refreshAccessToken(refreshToken) {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('XERO_APP_CREDENTIALS_MISSING');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();

  const res = await axios.post(TOKEN_URL, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
    }
  }).catch(err => {
    throw new Error(err.response?.data?.error_description || err.message || 'XERO_REFRESH_FAILED');
  });

  const data = res.data;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in ?? 1800,
    tenant_id: data.tenant_id ?? null
  };
}

/**
 * Persist Xero tokens for client (update client_integration values_json).
 */
async function saveXeroTokens(clientId, { access_token, refresh_token, expires_in, tenant_id }) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'xero'
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('XERO_NOT_CONFIGURED');

  const existing = typeof rows[0].values_json === 'string'
    ? JSON.parse(rows[0].values_json)
    : rows[0].values_json || {};
  const expiresAt = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : existing.xero_expires_at;

  const values = {
    ...existing,
    xero_access_token: access_token,
    xero_refresh_token: refresh_token ?? existing.xero_refresh_token,
    xero_expires_at: expiresAt,
    xero_tenant_id: tenant_id ?? existing.xero_tenant_id
  };
  await pool.query(
    'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(values), rows[0].id]
  );
}

/**
 * Get valid Xero access token for client (use cached or refresh).
 * @param {string} clientId - operatordetail.id
 * @returns {Promise<{ accessToken: string, tenantId: string }>}
 */
async function getValidXeroToken(clientId) {
  const integration = await getXeroIntegration(clientId);
  const expiresAt = integration.expires_at
    ? (typeof integration.expires_at === 'number'
      ? integration.expires_at
      : new Date(integration.expires_at).getTime())
    : 0;

  if (Date.now() < expiresAt - BUFFER_MS && integration.access_token) {
    return {
      accessToken: integration.access_token,
      tenantId: integration.tenant_id
    };
  }

  if (!integration.refresh_token) throw new Error('XERO_REFRESH_TOKEN_MISSING');

  const refreshed = await refreshAccessToken(integration.refresh_token);
  await saveXeroTokens(clientId, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_in: refreshed.expires_in,
    tenant_id: refreshed.tenant_id || integration.tenant_id
  });

  return {
    accessToken: refreshed.access_token,
    tenantId: refreshed.tenant_id || integration.tenant_id
  };
}

/**
 * Cleanlemons operator Xero — stored in cln_operator_integration (addonAccount, xero).
 */
async function getClnOperatorXeroIntegration(operatorId) {
  const [rows] = await pool.query(
    `SELECT values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND provider = 'xero' AND enabled = 1
     LIMIT 1`,
    [String(operatorId)]
  );
  if (!rows.length) throw new Error('XERO_NOT_CONFIGURED');
  const raw = rows[0].values_json;
  const values = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
  const access_token = values?.xero_access_token;
  const tenant_id = values?.xero_tenant_id;
  if (!access_token || !tenant_id) throw new Error('XERO_NOT_CONFIGURED');
  return {
    access_token,
    refresh_token: values?.xero_refresh_token || null,
    expires_at: values?.xero_expires_at ?? null,
    tenant_id
  };
}

async function saveClnOperatorXeroTokens(operatorId, { access_token, refresh_token, expires_in, tenant_id }) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = 'addonAccount' AND provider = 'xero'
     LIMIT 1`,
    [String(operatorId)]
  );
  if (!rows.length) throw new Error('XERO_NOT_CONFIGURED');
  const existing = typeof rows[0].values_json === 'string'
    ? JSON.parse(rows[0].values_json || '{}')
    : rows[0].values_json || {};
  const expiresAt = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : existing.xero_expires_at;
  const values = {
    ...existing,
    xero_access_token: access_token,
    xero_refresh_token: refresh_token ?? existing.xero_refresh_token,
    xero_expires_at: expiresAt,
    xero_tenant_id: tenant_id ?? existing.xero_tenant_id
  };
  await pool.query(
    'UPDATE cln_operator_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(values), rows[0].id]
  );
}

/**
 * Valid Xero token for portal.cleanlemons.com operator (cln_operator_integration).
 */
async function getValidXeroTokenForCleanlemonOperator(operatorId) {
  const integration = await getClnOperatorXeroIntegration(operatorId);
  const expiresAt = integration.expires_at
    ? (typeof integration.expires_at === 'number'
      ? integration.expires_at
      : new Date(integration.expires_at).getTime())
    : 0;

  if (Date.now() < expiresAt - BUFFER_MS && integration.access_token) {
    return {
      accessToken: integration.access_token,
      tenantId: integration.tenant_id
    };
  }

  if (!integration.refresh_token) throw new Error('XERO_REFRESH_TOKEN_MISSING');

  const refreshed = await refreshAccessToken(integration.refresh_token);
  await saveClnOperatorXeroTokens(operatorId, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
    expires_in: refreshed.expires_in,
    tenant_id: refreshed.tenant_id || integration.tenant_id
  });

  return {
    accessToken: refreshed.access_token,
    tenantId: refreshed.tenant_id || integration.tenant_id
  };
}

module.exports = {
  getXeroIntegration,
  refreshAccessToken,
  saveXeroTokens,
  getValidXeroToken,
  getClnOperatorXeroIntegration,
  saveClnOperatorXeroTokens,
  getValidXeroTokenForCleanlemonOperator
};
