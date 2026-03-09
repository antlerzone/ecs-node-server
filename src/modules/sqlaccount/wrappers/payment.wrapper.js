/**
 * SQL Account API: Payment Voucher (allocate payment to invoice / record payment).
 * Paths per Postman Collection; confirm with https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List payments. GET /Payment or path from Postman.
 */
async function listPayments(req, params = {}) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Payment',
    params
  });
}

/**
 * Get single payment. GET /Payment/{id}
 */
async function getPayment(req, paymentId) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `/Payment/${encodeURIComponent(paymentId)}`
  });
}

/**
 * Create payment. POST /Payment
 * @param {object} payload - Payment voucher payload per SQL Account API (invoice ref, account, amount, etc.)
 */
async function createPayment(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Payment',
    data: payload || {}
  });
}

module.exports = {
  listPayments,
  getPayment,
  createPayment
};
