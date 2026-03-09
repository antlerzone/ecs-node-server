/**
 * AutoCount Cloud Accounting API – Purchase Invoice (creditor bill).
 * @see https://accounting-api.autocountcloud.com/documentation/category/api-references/
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Create purchase invoice (cash purchase). POST /{accountBookId}/purchaseInvoice or similar.
 * Payload: { master: { creditorCode, docDate }, details: [{ productCode, description, qty, unitPrice }] }
 */
async function createPurchase(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/purchaseInvoice',
    apiKey,
    keyId,
    data: payload || {}
  });
}

module.exports = {
  createPurchase
};
