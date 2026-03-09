/**
 * SQL Account API: E-Invoice (MyInvois) submit / status / cancel.
 * @see https://docs.sql.com.my/sqlacc/usage/myinvois/e-invoice-operation
 * Paths per Postman Collection; confirm with SQL Account API docs.
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * Submit e-invoice for a document (invoice/debit note etc.).
 * POST /Invoice/{id}/SubmitEInvoice or path from Postman.
 */
async function submitEInvoice(req, documentIdOrDocNo) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: `/Invoice/${encodeURIComponent(documentIdOrDocNo)}/SubmitEInvoice`,
    data: {}
  });
}

/**
 * Get e-invoice status for a document.
 * GET /Invoice/{id}/EInvoiceStatus or path from Postman.
 */
async function getEInvoiceStatus(req, documentIdOrDocNo) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `/Invoice/${encodeURIComponent(documentIdOrDocNo)}/EInvoiceStatus`
  });
}

/**
 * Cancel e-invoice (within allowed period).
 * POST /Invoice/{id}/CancelEInvoice or path from Postman.
 */
async function cancelEInvoice(req, documentIdOrDocNo, body = {}) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: `/Invoice/${encodeURIComponent(documentIdOrDocNo)}/CancelEInvoice`,
    data: body
  });
}

module.exports = {
  submitEInvoice,
  getEInvoiceStatus,
  cancelEInvoice
};
