const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Submit e-invoice to LHDN MyInvois.
 * Document must be approved; debtor must have Tax Entity with TIN; products need Classification Codes.
 * API path may be: POST /{accountBookId}/invoice/submitEInvoice or /eInvoice/submit (confirm with API docs).
 * @param {object} req - Express request
 * @param {string} docNo - Document number (invoice)
 */
async function submitEInvoice(req, docNo) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/invoice/submitEInvoice',
    apiKey,
    keyId,
    params: { docNo },
    data: {}
  });
}

/**
 * Cancel/void e-invoice (within 72 hours of validation). Set EInvoiceCancelReason in body if required.
 * @param {object} req - Express request
 * @param {string} docNo - Document number
 * @param {object} [body] - e.g. { cancelReason: '...' }
 */
async function cancelEInvoice(req, docNo, body = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/invoice/cancelEInvoice',
    apiKey,
    keyId,
    params: { docNo },
    data: body
  });
}

/**
 * Get e-invoice status for a document (if API provides status endpoint).
 * @param {object} req - Express request
 * @param {string} docNo - Document number
 */
async function getEInvoiceStatus(req, docNo) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/invoice/eInvoiceStatus',
    apiKey,
    keyId,
    params: { docNo }
  });
}

module.exports = {
  submitEInvoice,
  cancelEInvoice,
  getEInvoiceStatus
};
