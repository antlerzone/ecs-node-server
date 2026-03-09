/**
 * SQL Account API: Purchase Invoice / Cash Purchase.
 * Paths per Postman Collection (download from SQL Account); confirm with https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List purchases. GET /Purchase or path from Postman.
 */
async function listPurchases(req, params = {}) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Purchase',
    params
  });
}

/**
 * Get single purchase. GET /Purchase/{id}
 */
async function getPurchase(req, purchaseId) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: `/Purchase/${encodeURIComponent(purchaseId)}`
  });
}

/**
 * Create purchase. POST /Purchase
 * @param {object} payload - Purchase payload per SQL Account API
 */
async function createPurchase(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Purchase',
    data: payload || {}
  });
}

/**
 * Update purchase. PUT /Purchase/{id}
 */
async function updatePurchase(req, purchaseId, payload) {
  return sqlaccountrequest({
    req,
    method: 'put',
    path: `/Purchase/${encodeURIComponent(purchaseId)}`,
    data: payload || {}
  });
}

module.exports = {
  listPurchases,
  getPurchase,
  createPurchase,
  updatePurchase
};
