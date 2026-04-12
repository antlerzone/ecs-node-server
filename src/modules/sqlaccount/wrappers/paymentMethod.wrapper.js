/**
 * SQL Account API: Payment Method (Postman → /pmmethod).
 */
const sqlaccountrequest = require('./sqlaccountrequest');
const { paymentMethod: PATH } = require('../lib/postmanPaths');

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH, params });
}

async function read(req, code) {
  const c = String(code || '').trim();
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'get', path: PATH, params: { code: c, limit: 1 } });
}

module.exports = {
  list,
  read
};

