/**
 * SQL Account API: Purchase Invoice (Postman → /purchaseinvoice).
 * Aligns with Bukku/Xero naming: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { purchaseInvoice: PATH } = require('../lib/postmanPaths');

function docPath(dockey) {
  const d = encodeURIComponent(String(dockey ?? '').trim());
  return `${PATH}/${d}`;
}

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH, params });
}

async function read(req, dockey) {
  return sqlaccountrequest({ req, method: 'get', path: docPath(dockey) });
}

async function create(req, payload) {
  return sqlaccountrequest({ req, method: 'post', path: PATH, data: payload || {} });
}

async function update(req, dockey, payload) {
  return sqlaccountrequest({ req, method: 'put', path: docPath(dockey), data: payload || {} });
}

async function remove(req, dockey) {
  return sqlaccountrequest({ req, method: 'delete', path: docPath(dockey) });
}

async function listPurchases(req, params = {}) {
  return list(req, params);
}

async function getPurchase(req, purchaseId) {
  return read(req, purchaseId);
}

async function createPurchase(req, payload) {
  return create(req, payload);
}

async function updatePurchase(req, purchaseId, payload) {
  return update(req, purchaseId, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listPurchases,
  getPurchase,
  createPurchase,
  updatePurchase
};
