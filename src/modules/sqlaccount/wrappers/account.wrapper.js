/**
 * SQL Account API: Account (chart of accounts).
 * Paths follow official API / Postman Collection; confirm with https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 * Flow: list existing → find by name/code → create if missing (sync).
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * List accounts. GET /Account or path from Postman (e.g. /Account/listing).
 * @param {object} req - Express request (req.client.id = clientId for creds)
 * @param {object} [params] - Query params
 * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
 */
async function listAccounts(req, params = {}) {
  const res = await sqlaccountrequest({
    req,
    method: 'get',
    path: '/Account',
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Create account. POST /Account (body from API docs).
 * @param {object} req - Express request
 * @param {object} payload - Account payload per SQL Account API
 */
async function createAccount(req, payload) {
  return sqlaccountrequest({
    req,
    method: 'post',
    path: '/Account',
    data: payload || {}
  });
}

module.exports = {
  listAccounts,
  createAccount
};
