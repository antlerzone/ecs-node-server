/**
 * AutoCount Cloud Accounting API – Account (Master Data).
 * @see https://accounting-api.autocountcloud.com/documentation/category/account/
 * Get Account Listing, Create Account, etc. Paths follow /{accountBookId}/account.
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * Get account listing. GET /{accountBookId}/account or /account/listing (confirm with API docs).
 * @param {object} req - Express request (client resolved)
 * @param {object} [params] - Query params e.g. page, pageSize
 * @returns {Promise<{ ok: boolean, data?: { accounts?: any[], account?: any[] }, error?: any }>}
 */
async function listAccounts(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/account',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Get one account by id/code. GET /{accountBookId}/account/{id} (path may vary; confirm with API docs).
 * @param {object} req - Express request
 * @param {string} accountId - Account id or code
 */
async function getAccount(req, accountId) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const endpoint = `/account/${encodeURIComponent(accountId)}`;
  return autocountrequest({
    method: 'get',
    accountBookId,
    endpoint,
    apiKey,
    keyId
  });
}

/**
 * Create account. POST /{accountBookId}/account
 * @param {object} req - Express request
 * @param {object} payload - Account input model (name, type, classification, etc.; see API docs)
 * @returns {Promise<{ ok: boolean, data?: { account?: any }, error?: any }>}
 */
async function createAccount(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/account',
    apiKey,
    keyId,
    data: payload || {}
  });
}

module.exports = {
  listAccounts,
  getAccount,
  createAccount
};
