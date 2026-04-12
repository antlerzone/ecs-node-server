/**
 * SQL Account API: Payment Voucher (Postman → /paymentvoucher).
 * Used for payment-out flows (e.g. refund deposit). Bukku/Xero-style: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { paymentVoucher: PATH } = require('../lib/postmanPaths');

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

async function listPayments(req, params = {}) {
  return list(req, params);
}

async function getPayment(req, paymentId) {
  return read(req, paymentId);
}

async function createPayment(req, payload) {
  return create(req, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listPayments,
  getPayment,
  createPayment
};
