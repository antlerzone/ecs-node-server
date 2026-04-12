/**
 * SQL Account API: Customer Payment (Postman → /customerpayment) — AR receipt / knock-off.
 * Bukku/Xero-style: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { customerPayment: PATH } = require('../lib/postmanPaths');

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

async function listReceipts(req, params = {}) {
  return list(req, params);
}

async function getReceipt(req, receiptId) {
  return read(req, receiptId);
}

async function createReceipt(req, payload) {
  return create(req, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listReceipts,
  getReceipt,
  createReceipt
};
