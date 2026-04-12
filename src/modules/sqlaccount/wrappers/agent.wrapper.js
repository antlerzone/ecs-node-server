/**
 * SQL Account API: Agent (Postman → /agent).
 * Bukku/Xero-style: list, read, create, update, remove.
 */

const sqlaccountrequest = require('./sqlaccountrequest');
const { agent: PATH } = require('../lib/postmanPaths');

function codePath(code) {
  const c = encodeURIComponent(String(code ?? '').trim());
  return `${PATH}/${c}`;
}

async function list(req, params = {}) {
  return sqlaccountrequest({ req, method: 'get', path: PATH, params });
}

async function read(req, code) {
  return sqlaccountrequest({ req, method: 'get', path: codePath(code) });
}

async function create(req, payload) {
  return sqlaccountrequest({ req, method: 'post', path: PATH, data: payload || {} });
}

async function update(req, code, payload) {
  return sqlaccountrequest({ req, method: 'put', path: codePath(code), data: payload || {} });
}

async function remove(req, code) {
  return sqlaccountrequest({ req, method: 'delete', path: codePath(code) });
}

/** @deprecated use list */
async function getAgents(req) {
  return list(req, {});
}

module.exports = {
  list,
  read,
  create,
  update,
  remove,
  getAgents
};
