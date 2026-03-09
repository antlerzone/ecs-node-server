/**
 * Credentials for SQL Account API (Malaysia, sql.com.my).
 * Auth: Access Key + Secret Key, used with AWS Signature Version 4.
 * Official linking overview: https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 * @see https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration
 */

const pool = require('../../../config/db');

/**
 * Get SQL Account API base URL (no trailing slash).
 * Prefer client_integration, then env SQLACCOUNT_BASE_URL.
 * @param {object} [req] - Express request (optional; if provided and has client, may read from client_integration)
 * @returns {Promise<string>}
 */
async function getBaseUrl(req = null) {
  if (req?.client) {
    const clientId = req.client.id ?? req.client.client_id;
    if (clientId) {
      const [rows] = await pool.query(
        `SELECT values_json FROM client_integration
         WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider IN ('sql', 'sqlaccount') AND enabled = 1 LIMIT 1`,
        [clientId]
      );
      if (rows.length) {
        const raw = rows[0].values_json;
        const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const url = values?.sqlaccount_base_url ?? values?.base_url;
        if (url && String(url).trim()) return String(url).trim().replace(/\/$/, '');
      }
    }
  }
  const url = process.env.SQLACCOUNT_BASE_URL;
  if (!url || !String(url).trim()) throw new Error('SQL Account base URL not configured: set SQLACCOUNT_BASE_URL or client_integration (provider=sqlaccount)');
  return String(url).trim().replace(/\/$/, '');
}

/**
 * Get Access Key and Secret Key for SQL Account API.
 * From client_integration (addonAccount, provider=sqlaccount) or env SQLACCOUNT_ACCESS_KEY / SQLACCOUNT_SECRET_KEY.
 * @param {object} [req] - Express request (optional)
 * @returns {Promise<{ accessKey: string, secretKey: string }>}
 */
async function getSqlAccountCreds(req = null) {
  if (req?.client) {
    const clientId = req.client.id ?? req.client.client_id;
    if (clientId) {
      const [rows] = await pool.query(
        `SELECT values_json FROM client_integration
         WHERE client_id = ? AND \`key\` = 'addonAccount' AND provider IN ('sql', 'sqlaccount') AND enabled = 1 LIMIT 1`,
        [clientId]
      );
      if (rows.length) {
        const raw = rows[0].values_json;
        const values = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const accessKey = values?.sqlaccount_access_key ?? values?.access_key;
        const secretKey = values?.sqlaccount_secret_key ?? values?.secret_key;
        if (accessKey && secretKey) {
          return { accessKey: String(accessKey), secretKey: String(secretKey) };
        }
      }
    }
  }
  const accessKey = process.env.SQLACCOUNT_ACCESS_KEY;
  const secretKey = process.env.SQLACCOUNT_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error('SQL Account API keys not configured: set SQLACCOUNT_ACCESS_KEY and SQLACCOUNT_SECRET_KEY or client_integration (provider=sqlaccount)');
  }
  return { accessKey: String(accessKey), secretKey: String(secretKey) };
}

/**
 * Get base URL, access key and secret key in one call.
 * @param {object} [req] - Express request (optional)
 * @returns {Promise<{ baseUrl: string, accessKey: string, secretKey: string }>}
 */
async function getSqlAccountCredsFull(req = null) {
  const [baseUrl, { accessKey, secretKey }] = await Promise.all([
    getBaseUrl(req),
    getSqlAccountCreds(req)
  ]);
  return { baseUrl, accessKey, secretKey };
}

module.exports = {
  getBaseUrl,
  getSqlAccountCreds,
  getSqlAccountCredsFull
};
