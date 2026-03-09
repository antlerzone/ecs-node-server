/**
 * Get Xero access token and tenant id for the current client.
 * Expects req.client to be set (e.g. by clientresolver); uses req.client.id to load
 * client_integration (addonAccount, provider=xero) and returns valid token (refresh if needed).
 * @param {object} req - Express request (req.client must be set)
 * @returns {Promise<{ accessToken: string, tenantId: string }>}
 */
const { getValidXeroToken } = require('./xeroToken.service');

async function getXeroCreds(req) {
  if (!req.client) throw new Error('missing client');
  const clientId = req.client.id;
  if (!clientId) throw new Error('missing client id');
  return getValidXeroToken(clientId);
}

module.exports = { getXeroCreds };
