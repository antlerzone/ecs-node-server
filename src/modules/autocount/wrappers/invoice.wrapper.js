const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Create invoice. POST /{accountBookId}/invoice
 * @param {object} req - Express request (client resolved)
 * @param {object} payload - Invoice Input Model: { master, details, autoFillOption?, saveApprove? }
 */
async function createInvoice(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/invoice',
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * Get invoice by docNo. GET /{accountBookId}/invoice?docNo=xxx
 */
async function getInvoice(req, docNo) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/invoice',
    apiKey,
    keyId,
    params: { docNo }
  });
}

/**
 * Void invoice. POST /{accountBookId}/invoice/void?docNo=xxx
 * Body: Void Document Input Model (e.g. {})
 */
async function voidInvoice(req, docNo, body = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/invoice/void',
    apiKey,
    keyId,
    params: { docNo },
    data: body
  });
}

module.exports = {
  createInvoice,
  getInvoice,
  voidInvoice
};
