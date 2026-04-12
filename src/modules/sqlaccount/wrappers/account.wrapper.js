/**
 * SQL Account API: chart of accounts (Postman: Account).
 * Method names align with Bukku/Xero account wrappers: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { account: PATH } = require('../lib/postmanPaths');

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH, params });
}

/** Single account: GET /account?code=… (Postman lists query filters on Get Account). */
async function read(req, code) {
  const c = String(code ?? '').trim();
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'get', path: PATH, params: { code: c, limit: 1 } });
}

async function create(req, payload) {
  return sqlaccountrequest({ req, method: 'post', path: PATH, data: payload || {} });
}

async function update(req, code, payload) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'put', path: `${PATH}/${c}`, data: payload || {} });
}

async function remove(req, code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  if (!c) return { ok: false, error: 'code is required' };
  return sqlaccountrequest({ req, method: 'delete', path: `${PATH}/${c}` });
}

/** @deprecated use list */
async function listAccounts(req, params = {}) {
  return list(req, params);
}

/** @deprecated use create */
async function createAccount(req, payload) {
  return create(req, payload);
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  listAccounts,
  createAccount
};
