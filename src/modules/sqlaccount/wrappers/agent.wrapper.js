/**
 * SQL Account API: Agent (example resource; exact path from Postman collection).
 * @see https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration
 */

const sqlaccountrequest = require('./sqlaccountrequest');

/**
 * Get agents list. Path may need to match SQL Account API (e.g. /Agent).
 * @param {object} [req] - Express request
 * @returns {Promise<{ ok: boolean, data?: any, status?: number, error?: any }>}
 */
async function getAgents(req) {
  return sqlaccountrequest({
    req,
    method: 'get',
    path: '/Agent'
  });
}

module.exports = {
  getAgents
};
