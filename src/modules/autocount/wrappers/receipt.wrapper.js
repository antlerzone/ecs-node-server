/**
 * AutoCount Cloud API – Receipt (receipt voucher / money received).
 * Endpoint paths per API docs; confirm with https://accounting-api.autocountcloud.com/documentation/
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Create receipt. POST /{accountBookId}/receipt (path may vary; confirm with API docs).
 */
async function createReceipt(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/receipt',
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * List receipts. GET /{accountBookId}/receipt
 */
async function listReceipts(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/receipt',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

module.exports = {
  createReceipt,
  listReceipts
};
