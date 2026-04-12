/**
 * Xero OAuth token for Cleanlemons portal operators (cln_operator_integration), not Coliving client_integration.
 * Used when req.cleanlemonOperatorId is set — see xero/lib/xeroCreds.js.
 */

const axios = require('axios');
const pool = require('../../config/db');

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const BUFFER_MS = 2 * 60 * 1000;
const KEY_ADDON = 'addonAccount';
const PROVIDER_XERO = 'xero';

function getClientId() {
  return (process.env.CLEANLEMON_XERO_CLIENT_ID || process.env.XERO_CLIENT_ID || '').trim();
}

function getClientSecret() {
  return (process.env.CLEANLEMON_XERO_CLIENT_SECRET || process.env.XERO_CLIENT_SECRET || '').trim();
}

async function getXeroIntegrationRow(operatorId) {
  const [rows] = await pool.query(
    `SELECT id, values_json FROM cln_operator_integration
     WHERE operator_id = ? AND \`key\` = ? AND provider = ? AND enabled = 1
     LIMIT 1`,
    [String(operatorId), KEY_ADDON, PROVIDER_XERO]
  );
  if (!rows.length) throw new Error('XERO_NOT_CONFIGURED');
  const raw = rows[0].values_json;
  const values = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  const access_token = values?.xero_access_token;
  const refresh_token = values?.xero_refresh_token;
  const tenant_id = values?.xero_tenant_id;
  if (!access_token || !tenant_id) throw new Error('XERO_NOT_CONFIGURED');
  return {
    rowId: rows[0].id,
    access_token,
    refresh_token: refresh_token || null,
    expires_at: values?.xero_expires_at ?? null,
    tenant_id
  };
}

async function saveTokens(rowId, merge) {
  const [rows] = await pool.query('SELECT values_json FROM cln_operator_integration WHERE id = ? LIMIT 1', [rowId]);
  if (!rows.length) throw new Error('XERO_ROW_MISSING');
  const existing = typeof rows[0].values_json === 'string' ? JSON.parse(rows[0].values_json) : rows[0].values_json || {};
  const values = { ...existing, ...merge };
  await pool.query('UPDATE cln_operator_integration SET values_json = ?, updated_at = NOW() WHERE id = ?', [
    JSON.stringify(values),
    rowId
  ]);
}

async function refreshAccessToken(refreshToken) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) throw new Error('XERO_APP_CREDENTIALS_MISSING');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();
  const res = await axios
    .post(TOKEN_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      }
    })
    .catch((err) => {
      throw new Error(err.response?.data?.error_description || err.message || 'XERO_REFRESH_FAILED');
    });
  const data = res.data;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in ?? 1800
  };
}

/**
 * @returns {Promise<{ accessToken: string, tenantId: string }>}
 */
async function getValidXeroTokenForCleanlemonOperator(operatorId) {
  const int = await getXeroIntegrationRow(operatorId);
  const expiresAt = int.expires_at
    ? typeof int.expires_at === 'number'
      ? int.expires_at
      : new Date(int.expires_at).getTime()
    : 0;

  if (Date.now() < expiresAt - BUFFER_MS && int.access_token) {
    return { accessToken: int.access_token, tenantId: String(int.tenant_id) };
  }
  if (!int.refresh_token) throw new Error('XERO_REFRESH_TOKEN_MISSING');
  const data = await refreshAccessToken(int.refresh_token);
  const expiresAtNew = new Date(Date.now() + (data.expires_in || 1800) * 1000).toISOString();
  await saveTokens(int.rowId, {
    xero_access_token: data.access_token,
    xero_refresh_token: data.refresh_token,
    xero_expires_at: expiresAtNew
  });
  return { accessToken: data.access_token, tenantId: String(int.tenant_id) };
}

module.exports = { getValidXeroTokenForCleanlemonOperator };
