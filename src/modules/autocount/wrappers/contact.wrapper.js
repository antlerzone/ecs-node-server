/**
 * AutoCount Cloud Accounting API – Contact / Parties (Debtor=Customer, Creditor=Supplier).
 * @see https://accounting-api.autocountcloud.com/documentation/ (Parties: Debtor, Creditor)
 * Paths may be /debtor, /creditor or /contact; confirm with API docs.
 */

const autocountrequest = require('./autocountrequest');
const { getAutoCountCreds } = require('../lib/autocountCreds');

/**
 * List debtors (customers). GET /{accountBookId}/debtor (or /debtor/listing; confirm with API docs).
 * @param {object} req - Express request (client resolved)
 * @param {object} [params] - Query params
 */
async function listDebtors(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/debtor',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Create debtor (customer). POST /{accountBookId}/debtor
 */
async function createDebtor(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/debtor',
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * Update debtor. PUT /{accountBookId}/debtor/{id} (path may vary)
 */
async function updateDebtor(req, debtorId, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const endpoint = `/debtor/${encodeURIComponent(debtorId)}`;
  return autocountrequest({
    method: 'put',
    accountBookId,
    endpoint,
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * List creditors (suppliers). GET /{accountBookId}/creditor
 */
async function listCreditors(req, params = {}) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const res = await autocountrequest({
    method: 'get',
    accountBookId,
    endpoint: '/creditor',
    apiKey,
    keyId,
    params
  });
  if (!res.ok) return res;
  return { ok: true, data: res.data };
}

/**
 * Create creditor (supplier). POST /{accountBookId}/creditor
 */
async function createCreditor(req, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  return autocountrequest({
    method: 'post',
    accountBookId,
    endpoint: '/creditor',
    apiKey,
    keyId,
    data: payload || {}
  });
}

/**
 * Update creditor. PUT /{accountBookId}/creditor/{id}
 */
async function updateCreditor(req, creditorId, payload) {
  const { apiKey, keyId, accountBookId } = await getAutoCountCreds(req);
  const endpoint = `/creditor/${encodeURIComponent(creditorId)}`;
  return autocountrequest({
    method: 'put',
    accountBookId,
    endpoint,
    apiKey,
    keyId,
    data: payload || {}
  });
}

module.exports = {
  listDebtors,
  createDebtor,
  updateDebtor,
  listCreditors,
  createCreditor,
  updateCreditor
};
