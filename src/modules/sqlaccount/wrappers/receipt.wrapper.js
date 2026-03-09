/**
 * SQL Account API: Receipt Voucher (record receipt / money received).
 * Paths per Postman Collection; confirm with https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List receipts. GET /Receipt or path from Postman.
 */
async function listReceipts(req, params = {}) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Receipt',
    params
  });
}

/**
 * Get single receipt. GET /Receipt/{id}
 */
async function getReceipt(req, receiptId) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `/Receipt/${encodeURIComponent(receiptId)}`
  });
}

/**
 * Create receipt. POST /Receipt
 * @param {object} payload - Receipt voucher payload per SQL Account API
 */
async function createReceipt(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Receipt',
    data: payload || {}
  });
}

module.exports = {
  listReceipts,
  getReceipt,
  createReceipt
};
