/**
 * Finverse API wrapper (SaaS – per operator).
 * Bank Data API for payment verification: link bank → get transactions → match with receipts.
 * Each operator connects their own Finverse (client_id/client_secret in client_integration or env).
 *
 * Usage:
 *   const finverse = require('./src/modules/finverse');
 *   const { link_url } = await finverse.auth.generateLinkToken(clientId, { state: '...' });
 *   const { access_token } = await finverse.auth.exchangeCodeForLoginIdentity(clientId, { code });
 *   const { transactions } = await finverse.bankData.listTransactions(access_token, { from_date, to_date });
 */

const { getFinverseCredsByClient, getFinverseCredsFromReq } = require('./lib/finverseCreds');
const { getValidCustomerAccessToken, invalidateCustomerToken } = require('./lib/finverseToken.service');
const { getCustomerAccessToken, finverseRequest, BASE_URL } = require('./wrappers/finverseRequest');
const auth = require('./wrappers/auth.wrapper');
const bankData = require('./wrappers/bankData.wrapper');

module.exports = {
  getFinverseCredsByClient,
  getFinverseCredsFromReq,
  getValidCustomerAccessToken,
  invalidateCustomerToken,
  getCustomerAccessToken,
  finverseRequest,
  BASE_URL,
  auth,
  bankData
};
