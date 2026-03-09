/**
 * SQL Account API: Sales Invoice / Cash Sales.
 * Paths per Postman Collection (download from SQL Account); confirm with https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List invoices. GET /Invoice or path from Postman.
 */
async function listInvoices(req, params = {}) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Invoice',
    params
  });
}

/**
 * Get single invoice. GET /Invoice/{id}
 */
async function getInvoice(req, invoiceId) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `/Invoice/${encodeURIComponent(invoiceId)}`
  });
}

/**
 * Create invoice. POST /Invoice
 * @param {object} payload - Invoice payload per SQL Account API (contact, line items, etc.)
 */
async function createInvoice(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Invoice',
    data: payload || {}
  });
}

/**
 * Update invoice. PUT /Invoice/{id}
 */
async function updateInvoice(req, invoiceId, payload) {
  return sqlaccountrequest({
    req,
    method: 'put',
    path: `/Invoice/${encodeURIComponent(invoiceId)}`,
    data: payload || {}
  });
}

module.exports = {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice
};
