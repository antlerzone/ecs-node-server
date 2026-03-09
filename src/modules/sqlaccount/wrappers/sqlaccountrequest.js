/**
 * SQL Account API request with AWS Signature Version 4.
 * Official API / linking docs: https://wiki.sql.com.my/wiki/SQL_Accounting_Linking
 * @see https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration
 */

const url = require('url');
const axios = require('axios');
const aws4 = require('aws4');
const { getSqlAccountCredsFull } = require('../lib/sqlaccountCreds');

const DEFAULT_SERVICE = process.env.SQLACCOUNT_AWS_SERVICE || 'sqlaccount';
const DEFAULT_REGION = process.env.SQLACCOUNT_AWS_REGION || 'us-east-1';

/**
 * Call SQL Account API with AWS Sig v4.
 * @param {object} opts
 * @param {object} [opts.req] - Express request (for client-scoped creds)
 * @param {string} opts.method - get|post|put|patch|delete
 * @param {string} opts.path - API path (e.g. /Agent or /api/v1/agents), no leading slash optional
 * @param {object} [opts.data] - JSON body for post/put/patch
 * @param {object} [opts.params] - Query params
 * @returns {Promise<{ ok: boolean, data?: any, status?: number, error?: any }>}
 */
async function sqlaccountrequest({ req = null, method = 'get', path = '', data, params }) {
  let baseUrl;
  let accessKey;
  let secretKey;
  try {
    const creds = await getSqlAccountCredsFull(req);
    baseUrl = creds.baseUrl;
    accessKey = creds.accessKey;
    secretKey = creds.secretKey;
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }

  const pathNorm = path.startsWith('/') ? path : `/${path}`;
  const queryStr = params && Object.keys(params).length
    ? '?' + new URLSearchParams(params).toString()
    : '';
  const pathWithQuery = pathNorm + queryStr;

  const parsed = url.parse(baseUrl);
  const hostname = parsed.hostname || parsed.host;
  const port = parsed.port;
  const requestUrl = (baseUrl.replace(/\/$/, '') + pathWithQuery);

  const body = data != null ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined;
  const opts = {
    host: hostname,
    path: pathWithQuery,
    method: (method || 'GET').toUpperCase(),
    body,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    service: DEFAULT_SERVICE,
    region: DEFAULT_REGION
  };
  if (port) opts.port = port;

  aws4.sign(opts, {
    accessKeyId: accessKey,
    secretAccessKey: secretKey
  });

  try {
    const axiosConfig = {
      method: opts.method,
      url: requestUrl,
      headers: opts.headers,
      validateStatus: () => true
    };
    if (body !== undefined) axiosConfig.data = body;
    const res = await axios(axiosConfig);
    const ok = res.status >= 200 && res.status < 300;
    return ok
      ? { ok: true, data: res.data, status: res.status }
      : { ok: false, status: res.status, error: res.data || res.statusText };
  } catch (err) {
    return {
      ok: false,
      status: err.response?.status,
      error: err.response?.data ?? err.message
    };
  }
}

module.exports = sqlaccountrequest;
