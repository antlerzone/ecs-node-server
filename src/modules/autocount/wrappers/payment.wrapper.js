/**
 * AutoCount Cloud API – Payment (payment voucher / allocate payment).
 * Endpoint paths per API docs; confirm with https://accounting-api.autocountcloud.com/documentation/
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Create payment. POST /{accountBookId}/payment (path may vary; confirm with API docs).
 */
async function createPayment(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/payment',
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * List payments. GET /{accountBookId}/payment
 */
async function listPayments(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/payment',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

module.exports = {
  createPayment,
  listPayments
};
