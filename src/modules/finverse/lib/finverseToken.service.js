/**
 * Finverse token service (SaaS – per operator).
 * Customer access token: from Finverse API (client_credentials), cached in memory per client.
 * Login identity token: obtained after user links bank via Link UI; stored in client_integration or passed per request.
 */

const { getFinverseCredsByClient } = require('./finverseCreds');
const { getCustomerAccessToken } = require('../wrappers/finverseRequest');

const CUSTOMER_TOKEN_MAX_AGE_MS = 50 * 60 * 1000; // 50 min (Finverse typically 1h)

const customerTokenCache = new Map();

/**
 * Get valid customer access token for client (operator). Cached in memory.
 * @param {string} clientId
 * @returns {Promise<{ access_token: string, expires_in?: number }>}
 */
async function getValidCustomerAccessToken(clientId) {
  if (!clientId) throw new Error('CLIENT_ID_REQUIRED');

  // Optional: use static token from env (e.g. if Finverse provides long-lived Bearer in Developer Portal).
  const staticToken = process.env.FINVERSE_ACCESS_TOKEN;
  if (staticToken && staticToken.trim()) {
    return { access_token: staticToken.trim(), expires_in: 86400 };
  }

  const cached = customerTokenCache.get(clientId);
  if (cached && Date.now() < cached.expiresAt) {
    return { access_token: cached.access_token, expires_in: cached.expires_in };
  }

  const creds = await getFinverseCredsByClient(clientId);
  const resp = await getCustomerAccessToken(creds);
  const expiresIn = (resp.expires_in && resp.expires_in > 0) ? resp.expires_in : 3600;
  customerTokenCache.set(clientId, {
    access_token: resp.access_token,
    expires_in: expiresIn,
    expiresAt: Date.now() + (expiresIn * 1000) - 60000
  });
  return { access_token: resp.access_token, expires_in: expiresIn };
}

/**
 * Invalidate customer token cache for a client (e.g. after credential change).
 */
function invalidateCustomerToken(clientId) {
  if (clientId) customerTokenCache.delete(clientId);
  else customerTokenCache.clear();
}

module.exports = {
  getValidCustomerAccessToken,
  invalidateCustomerToken
};
