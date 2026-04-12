/**
 * Finverse Bank Data API wrapper (for payment verification).
 * Uses login identity access token (obtained after user links bank via Link UI).
 * Ref: https://docs.finverse.com – Data API (accounts, transactions).
 */

const { finverseRequest } = require('./finverseRequest');

/**
 * Get login identity (status, etc.). Poll until status is DATA_RETRIEVAL_COMPLETE or ERROR.
 * @param {string} loginIdentityAccessToken - From exchangeCodeForLoginIdentity
 * @returns {Promise<{ login_identity: object }>}
 */
async function getLoginIdentity(loginIdentityAccessToken) {
  const data = await finverseRequest('GET', '/login_identities/me', {
    accessToken: loginIdentityAccessToken
  });
  return data;
}

/**
 * List accounts for the linked login identity.
 * @param {string} loginIdentityAccessToken
 * @returns {Promise<{ accounts: Array }>}
 */
async function listAccounts(loginIdentityAccessToken) {
  const data = await finverseRequest('GET', '/accounts', {
    accessToken: loginIdentityAccessToken
  });
  return { accounts: data.accounts || data.data || [] };
}

/**
 * List transactions for payment matching (amount, reference, date, payer).
 * @param {string} loginIdentityAccessToken
 * @param {{ offset?: number, limit?: number, from_date?: string, to_date?: string }} opts
 * @returns {Promise<{ transactions: Array, total_transactions?: number }>}
 */
async function listTransactions(loginIdentityAccessToken, opts = {}) {
  const params = {};
  if (opts.offset != null) params.offset = String(opts.offset);
  if (opts.limit != null) params.limit = String(opts.limit);
  if (opts.from_date) params.from_date = opts.from_date;
  if (opts.to_date) params.to_date = opts.to_date;
  const data = await finverseRequest('GET', '/transactions', {
    accessToken: loginIdentityAccessToken,
    params
  });
  return {
    transactions: data.transactions || data.data || [],
    total_transactions: data.total_transactions ?? data.total
  };
}

/**
 * Poll login identity until data is ready (for use after link or refresh).
 * @param {string} loginIdentityAccessToken
 * @param {{ maxAttempts?: number, intervalMs?: number }} opts
 * @returns {Promise<{ login_identity: object }>}
 */
async function pollLoginIdentityUntilReady(loginIdentityAccessToken, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 20;
  const intervalMs = opts.intervalMs ?? 3000;
  const terminal = ['ERROR', 'DATA_RETRIEVAL_COMPLETE', 'DATA_RETRIEVAL_PARTIALLY_SUCCESSFUL', 'CONNECTION_COMPLETE'];
  for (let i = 0; i < maxAttempts; i++) {
    const data = await getLoginIdentity(loginIdentityAccessToken);
    const status = data.login_identity?.status;
    if (status && terminal.includes(status)) {
      return data;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('FINVERSE_POLL_TIMEOUT');
}

module.exports = {
  getLoginIdentity,
  listAccounts,
  listTransactions,
  pollLoginIdentityUntilReady
};
