const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Validate document (e.g. invoice) for e-invoice readiness.
 * AutoCount Cloud API: validate endpoint if available (path may vary by API version).
 * Common pattern: POST /{accountBookId}/invoice/validate or /document/validate.
 * @param {object} req - Express request
 * @param {string} docNo - Document number to validate
 * @param {object} [options] - Optional: { documentType: 'invoice' }
 */
async function validateDocument(req, docNo, options = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const documentType = (options.documentType || 'invoice').toLowerCase();
  const endpoint = documentType === 'invoice' ? '/invoice/validate' : `/${documentType}/validate`;
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint,
    apiKey,
    keyId,
    params: { docNo },
    data: options.body ?? {}
  });
}

/**
 * Validate invoice by docNo. Convenience wrapper for validateDocument(..., { documentType: 'invoice' }).
 */
async function validateInvoice(req, docNo) {
  return validateDocument(req, docNo, { documentType: 'invoice' });
}

module.exports = {
  validateDocument,
  validateInvoice
};
