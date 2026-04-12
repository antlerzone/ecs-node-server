/**
 * Finverse credentials per operator (SaaS client).
 * Reads client_id, client_secret, redirect_uri from client_integration (key=bankData, provider=finverse).
 * Fallback: env FINVERSE_CLIENT_ID, FINVERSE_CLIENT_SECRET, FINVERSE_REDIRECT_URI for single-tenant.
 */

const pool = require('../../../config/db');

const INTEGRATION_KEY = 'bankData';
const INTEGRATION_PROVIDER = 'finverse';

/**
 * Get Finverse credentials for a client (operator).
 * @param {string} clientId - Our client id (operatordetail.id / operator)
 * @returns {Promise<{ client_id: string, client_secret: string, redirect_uri?: string }>}
 */
async function getFinverseCredsByClient(clientId) {
  if (!clientId) throw new Error('FINVERSE_CLIENT_ID_REQUIRED');

  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = ? AND provider = ? AND enabled = 1
     LIMIT 1`,
    [clientId, INTEGRATION_KEY, INTEGRATION_PROVIDER]
  );

  if (rows.length) {
    const raw = rows[0].values_json;
    const values = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
    const client_id = (values.finverse_client_id || values.client_id || '').toString().trim();
    const client_secret = (values.finverse_client_secret || values.client_secret || '').toString().trim();
    const redirect_uri = (values.finverse_redirect_uri || values.redirect_uri || '').toString().trim() || undefined;
    if (client_id && client_secret) {
      return { client_id, client_secret, redirect_uri, _source: 'client_integration' };
    }
  }

  const client_id = (process.env.FINVERSE_CLIENT_ID || '').trim();
  const client_secret = (process.env.FINVERSE_CLIENT_SECRET || '').trim();
  const redirect_uri = (process.env.FINVERSE_REDIRECT_URI || '').trim() || undefined;
  if (client_id && client_secret) {
    return { client_id, client_secret, redirect_uri, _source: 'env' };
  }

  throw new Error('FINVERSE_NOT_CONFIGURED');
}

/**
 * Get Finverse creds from Express req (req.client.id).
 */
async function getFinverseCredsFromReq(req) {
  if (!req?.client?.id) throw new Error('missing client');
  return getFinverseCredsByClient(req.client.id);
}

/**
 * Save Finverse login_identity_token for operator (after OAuth callback).
 * Upserts client_integration (key=bankData, provider=finverse); merges finverse_login_identity_token into values_json.
 * If no row exists, creates one using env FINVERSE_* (single-tenant).
 */
async function saveLoginIdentityToken(clientId, loginIdentityToken) {
  if (!clientId || !loginIdentityToken) throw new Error('CLIENT_ID_AND_TOKEN_REQUIRED');
  const [rows] = await pool.query(
    `SELECT id, values_json FROM client_integration WHERE client_id = ? AND \`key\` = ? AND provider = ? LIMIT 1`,
    [clientId, INTEGRATION_KEY, INTEGRATION_PROVIDER]
  );
  const crypto = require('crypto');
  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  if (rows.length) {
    const raw = rows[0].values_json;
    const values = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
    values.finverse_login_identity_token = loginIdentityToken;
    await pool.query(
      'UPDATE client_integration SET values_json = ?, updated_at = NOW() WHERE id = ?',
      [JSON.stringify(values), rows[0].id]
    );
    return;
  }
  const client_id = process.env.FINVERSE_CLIENT_ID;
  const client_secret = process.env.FINVERSE_CLIENT_SECRET;
  const redirect_uri = process.env.FINVERSE_REDIRECT_URI;
  if (!client_id || !client_secret) throw new Error('FINVERSE_NOT_CONFIGURED_SAVE_TOKEN');
  const id = crypto.randomUUID();
  const values = {
    finverse_client_id: client_id,
    finverse_client_secret: client_secret,
    finverse_redirect_uri: redirect_uri || undefined,
    finverse_login_identity_token: loginIdentityToken
  };
  await pool.query(
    `INSERT INTO client_integration (id, client_id, \`key\`, version, slot, enabled, provider, values_json, created_at, updated_at)
     VALUES (?, ?, ?, 1, 0, 1, ?, ?, ?, ?)`,
    [id, clientId, INTEGRATION_KEY, INTEGRATION_PROVIDER, JSON.stringify(values), now, now]
  );
}

module.exports = { getFinverseCredsByClient, getFinverseCredsFromReq, saveLoginIdentityToken, INTEGRATION_KEY, INTEGRATION_PROVIDER };
