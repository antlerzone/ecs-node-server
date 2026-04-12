/**
 * Get TTLock auth (app clientId + accessToken) for the current client.
 * Used by wrappers: clientId = req.client.id (SaaS per client).
 * TTLOCK_CLIENT_ID = TTLock Open Platform app_id (same for all tenants).
 */

const { getValidTTLockToken } = require('./ttlockToken.service');

/**
 * Get auth for API calls: { clientId (TTLock app), accessToken }.
 * @param {string} clientId - Our client id (operatordetail.id)
 * @returns {Promise<{ clientId: string, accessToken: string }>}
 */
async function getTtlockAuth(clientId) {
  const appClientId = process.env.TTLOCK_CLIENT_ID;
  if (!appClientId) throw new Error('TTLOCK_APP_CREDENTIALS_MISSING');

  const token = await getValidTTLockToken(clientId);
  if (!token?.accessToken) throw new Error('TTLOCK_NO_TOKEN');

  return {
    clientId: appClientId,
    accessToken: token.accessToken
  };
}

/**
 * Get auth from Express req (req.client.id).
 * @param {object} req - Express request (req.client must be set by clientresolver)
 */
function getTtlockAuthFromReq(req) {
  if (!req?.client?.id) throw new Error('missing client');
  return getTtlockAuth(req.client.id);
}

module.exports = { getTtlockAuth, getTtlockAuthFromReq };
