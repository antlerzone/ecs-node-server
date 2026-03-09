/**
 * Get AutoCount API credentials for the current client.
 * Loads from client_integration (key=addonAccount, provider=autocount) values_json.
 * req.client is from clientresolver (subdomain -> clients); client_id may be req.client.id or req.client.client_id.
 * @param {object} req - Express request (req.client must be set)
 * @returns {Promise<{ apiKey: string, keyId: string, accountBookId: string|number }>}
 */
const pool = require('../../../config/db');

async function getAutoCountCreds(req) {
  if (!req.client) throw new Error('missing client');
  const clientId = req.client.id ?? req.client.client_id;
  if (!clientId) throw new Error('missing client id');
  const [rows] = await pool.query(
    `SELECT values_json FROM client_integration
     WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider = 'autocount' AND enabled = 1 LIMIT 1`,
    [clientId]
  );
  if (!rows.length) throw new Error('autocount not configured for this client');
  const raw = rows[0].values_json;
  const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const apiKey = values?.autocount_apiKey ?? values?.autocount_api_key;
  const keyId = values?.autocount_keyId ?? values?.autocount_key_id;
  const accountBookId = values?.autocount_accountBookId ?? values?.autocount_account_book_id;
  if (!apiKey || !keyId) {
    throw new Error('missing autocount apiKey or keyId for this client');
  }
  if (accountBookId == null || accountBookId === '') {
    throw new Error('missing autocount accountBookId for this client');
  }
  return { apiKey, keyId, accountBookId };
}

module.exports = { getAutoCountCreds };
