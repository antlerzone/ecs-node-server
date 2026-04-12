const axios = require('axios');

/** Production API root — https://www.billplz.com/api/ */
const BILLPLZ_BASE_URL = 'https://www.billplz.com/api';
/** Sandbox — https://www.billplz-sandbox.com/api/ (separate Billplz account) */
const BILLPLZ_SANDBOX_BASE_URL = 'https://www.billplz-sandbox.com/api';
const BILLPLZ_TIMEOUT_MS = Number(process.env.BILLPLZ_TIMEOUT_MS) || 20000;

/**
 * Which host to call: production vs sandbox.
 * @param {boolean} requestedUseSandbox - from DB (`billplz_use_sandbox`) or `SAAS_COLIVING_BILLPLZ_USE_SANDBOX`
 *
 * Global overrides (e.g. ECS `.env` when going live):
 * - `BILLPLZ_USE_SANDBOX=0` | `false` | `no` → always production API
 * - `BILLPLZ_USE_SANDBOX=1` | `true` | `yes` → always sandbox API
 * - `BILLPLZ_FORCE_PRODUCTION=1` | `true` → always production (migration helper)
 * - unset → follow `requestedUseSandbox`
 */
function resolveUseSandbox(requestedUseSandbox) {
  const g = String(process.env.BILLPLZ_USE_SANDBOX ?? '').trim().toLowerCase();
  if (g === '0' || g === 'false' || g === 'no') return false;
  if (g === '1' || g === 'true' || g === 'yes') return true;
  const fp = String(process.env.BILLPLZ_FORCE_PRODUCTION ?? '').trim().toLowerCase();
  if (fp === '1' || fp === 'true') return false;
  return !!requestedUseSandbox;
}

function getBillplzBaseUrl(useSandbox = false) {
  return useSandbox ? BILLPLZ_SANDBOX_BASE_URL : BILLPLZ_BASE_URL;
}

function normalizeEndpoint(version, endpoint) {
  const v = String(version || 'v3').trim().replace(/^\/+|\/+$/g, '');
  const p = String(endpoint || '').trim();
  if (!p) throw new Error('BILLPLZ_ENDPOINT_REQUIRED');
  return `/${v}${p.startsWith('/') ? p : `/${p}`}`;
}

function normalizeBillplzError(err) {
  return {
    ok: false,
    status: err?.response?.status || null,
    error: err?.response?.data || err?.message || 'BILLPLZ_REQUEST_FAILED',
    headers: err?.response?.headers || null
  };
}

async function billplzrequest({
  apiKey,
  version = 'v3',
  endpoint,
  method = 'get',
  data,
  params,
  headers = {},
  useSandbox = false,
  timeoutMs = BILLPLZ_TIMEOUT_MS
}) {
  const secret = String(apiKey || '').trim();
  if (!secret) {
    return { ok: false, status: 401, error: 'BILLPLZ_API_KEY_REQUIRED', headers: null };
  }
  try {
    const sand = resolveUseSandbox(useSandbox);
    const res = await axios({
      method,
      url: `${getBillplzBaseUrl(sand)}${normalizeEndpoint(version, endpoint)}`,
      auth: { username: secret, password: '' },
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      data,
      params,
      timeout: timeoutMs
    });
    return {
      ok: true,
      status: res.status,
      data: res.data,
      headers: res.headers || null
    };
  } catch (err) {
    return normalizeBillplzError(err);
  }
}

module.exports = billplzrequest;
module.exports.getBillplzBaseUrl = getBillplzBaseUrl;
module.exports.resolveUseSandbox = resolveUseSandbox;
module.exports.normalizeEndpoint = normalizeEndpoint;
