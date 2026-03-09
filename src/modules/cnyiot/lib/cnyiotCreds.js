/**
 * Get CNYIoT auth (apiKey + loginID) for the current client.
 * apiKey is used encrypted in request (see cnyiotRequest).
 */

const { getValidCnyIotToken } = require('./cnyiotToken.service');

/**
 * Get raw token for API calls: { apiKey, loginID }.
 * @param {string} clientId - Our client id (clientdetail.id)
 */
async function getCnyIotAuth(clientId) {
  return getValidCnyIotToken(clientId);
}

/**
 * From Express req (req.client.id).
 */
function getCnyIotAuthFromReq(req) {
  if (!req?.client?.id) throw new Error('missing client');
  return getValidCnyIotToken(req.client.id);
}

module.exports = { getCnyIotAuth, getCnyIotAuthFromReq };
